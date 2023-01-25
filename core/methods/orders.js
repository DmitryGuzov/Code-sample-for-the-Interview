const logger = require('../common/loggers').get('ORDERS');

const { round } = require('mathjs');
const errors = require('../common/errors');
const users = require('./users');
const tickets = require('./tickets');
const credits = require('./credits');
const Order = require('../models/order').order;
const Raffle = require('../models/raffle');
const FixedOdds = require('../models/fixedOdds');
const Prize = require('../models/prize');
const GeneralSettings = require('../models/generalSettings');
const Credit = require('../models/credit');
const Coupon = require('../models/coupon');
const CouponUser = require('../models/couponUser');

const createSocialLinks = require('./createSocialLinks');
const mail = require('../tools/mail');
const tokens = require('../tools/tokens');
const intercomClient = require('../tools/intercom');
const conversionAPI = require('../tools/facebookBusiness');
const Competition = require('../models/competitions');

const _getPrizeTypeOfOrder = (order) => {
  if (order.hasOwnProperty('raffle')) {
    return 'raffle';
  }

  if (order.hasOwnProperty('prize')) {
    return 'prize';
  }

  if (order.hasOwnProperty('fixedOdds')) {
    return 'fixedOdds';
  }

  return '';
};

const _checkCompetitionFixedOddsPounds = async (competitionId, userId) => {
  if (!userId) {
    return 0;
  }
  const queryAcceptedOrders = await Order.find({
    $and: [
      { user: userId },
      { competitionId: competitionId },
      {
        $or: [
          { paymentStatus: Order.PaymentStatus.ACCEPTED },
          { paymentStatus: Order.PaymentStatus.PENDING_BASKET },
        ],
      },
    ],
  })
    .lean()
    .select('totalCost spentCredits');

  const payedAmount = queryAcceptedOrders.reduce((accumulator, order) => {
    return accumulator + order.totalCost - order.spentCredits;
  }, 0);

  const totalAmount = payedAmount / 100;

  return totalAmount;
};

const _fixedOddsVerification = async (
  prize,
  competitionId,
  userId,
  ticketPrice,
  numOfTickets
) => {
  const oddsCompetitionPounds = await _checkCompetitionFixedOddsPounds(
    competitionId,
    userId
  );
  const totalPayed = oddsCompetitionPounds + ticketPrice * numOfTickets;

  if (totalPayed > 250) {
    logger.error(
      `Fixed odds competition £250 limit exceeded for user ${userId}`
    );
    throw new errors.BadRequestError(
      'Fixed odds competition £250 limit exceeded'
    );
  }

  // const reservedOddsTickets = await _checkOddsTicketsReserve(prize._id);

  if (prize.maxTickets < prize.ticketsBought + numOfTickets) {
    logger.error(
      `The maximum number of tickets for fixed odd ${prize._id} has been exceeded`
    );
    throw new errors.BadRequestError(
      'The maximum number of tickets for fixed odd has been exceeded'
    );
  }
};

const _calculateTicketPrice = (
  prize,
  numOfTickets,
  generalSettings,
  prizeType,
  coupon
) => {
  let ticketPrice = prize.ticketPrice;

  if (prize.isActiveDiscount) {
    ticketPrice = prize.discountTicket.newPrice;
  }

  if (prize.isDiscountRates) {
    let queryRateDiscount = _filterDiscountRates(
      prize.discountRates,
      numOfTickets
    );
    if (queryRateDiscount) ticketPrice = queryRateDiscount.newPrice;
  }

  if (!prize.isDiscountRates) {
    if (generalSettings.isDiscountRates[prizeType]) {
      let queryRateDiscount = _filterDiscountRates(
        generalSettings.discountRates[prizeType],
        numOfTickets
      );

      if (queryRateDiscount) {
        let value1 = round((ticketPrice / 100) * queryRateDiscount.percent, 12);
        let value2 = round(ticketPrice - value1, 12);
        let result = round(value2, 2);

        ticketPrice = result;
      }
    }
  }

  if (coupon && coupon.type === Coupon.type.BASKET) {
    if (!coupon.discountType || coupon.discountType === prizeType) {
      let value1 = round((ticketPrice / 100) * coupon.value, 12);
      let value2 = round(ticketPrice - value1, 12);
      return (ticketPrice = value2);
    }
  }

  if (numOfTickets === 15 && prizeType === 'raffle') {
    return ticketPrice;
  }

  return roundedPrice(ticketPrice);
};

const _filterDiscountRates = (discountRates, numOfTickets) => {
  let filteredArray = discountRates.filter(
    (i) => i.amountTickets <= numOfTickets
  );
  filteredArray.sort((a, b) =>
    a.amountTickets > b.amountTickets
      ? 1
      : b.amountTickets > a.amountTickets
      ? -1
      : 0
  );
  return filteredArray.pop();
};

const _filterCreditRates = (creditRates = [], orderTotalCost = 0) => {
  let filteredArray = creditRates.filter(
    (i) => i.count <= orderTotalCost / 100
  );
  filteredArray.sort((a, b) =>
    a.count > b.count ? 1 : b.count > a.count ? -1 : 0
  );
  return filteredArray.pop();
};

const _createOrder = async (
  numOfTickets,
  user,
  prizeType,
  prizeId,
  bonus = false,
  afterLogin = false
) => {
  let collection = null;
  let competitionType = '';

  switch (prizeType) {
    case 'raffle':
      collection = Raffle;
      competitionType = Competition.CompetitionType.DREAMHOME;
      break;

    case 'prize':
      collection = Prize;
      competitionType = Competition.CompetitionType.PRIZE;
      break;

    case 'fixedOdds':
      collection = FixedOdds;
      competitionType = Competition.CompetitionType.FIXED_ODDS;
      break;

    default:
      break;
  }

  if (!collection) {
    logger.error(`Incorrect prize type`);
    throw new errors.BadRequestError('Incorrect prize type');
  }

  if (!competitionType) {
    logger.error(`Incorrect competitionType`);
    throw new errors.BadRequestError('Incorrect competition type');
  }

  if (numOfTickets > 1000) {
    logger.error(`Maximum number of tickets per order 1000`);
    throw new errors.BadRequestError(
      'Maximum number of tickets per order 1000'
    );
  }

  const prize = await collection
    .findById(prizeId)
    .select(
      '_id active maxTickets ticketsBought isDiscountRates isActiveDiscount discountTicket ticketPrice discountRates endsAt isFreeTicketsRates freeTicketsRates title'
    )
    .lean();

  if (!prize) {
    logger.error(`Prize not found`);
    if (afterLogin) {
      return;
    }
    throw new errors.NotFoundError('Prize not found');
  }

  if (!prize.active) {
    logger.error(`Prize ${prize._id} is not active`);
    if (afterLogin) {
      return;
    }
    throw new errors.BadRequestError('Prize is not active');
  }

  if (prizeType === 'raffle' && Date.now() > new Date(prize.endsAt)) {
    logger.error(`Prize ${prize._id} is not active`);
    if (afterLogin) {
      return;
    }
    throw new errors.BadRequestError('Prize is not active');
  }

  let generalSettings = await GeneralSettings.findOne()
    .lean()
    .select(
      'isDiscountRates discountRates isFreeTicketsRates freeTicketsRates'
    );

  const fixedOddsCompetitionQuery =
    prizeType === 'fixedOdds' ? { fixedOdds: prize._id } : {};

  const competition = await Competition.findOne({
    $and: [{ competitionType }, { isActive: true }, fixedOddsCompetitionQuery],
  })
    .select('_id')
    .lean();

  let ticketPrice = _calculateTicketPrice(
    prize,
    numOfTickets,
    generalSettings,
    prizeType
  );

  if (prizeType === 'fixedOdds') {
    await _fixedOddsVerification(
      prize,
      competition._id,
      user._id,
      ticketPrice,
      numOfTickets
    );
  }

  let newTicketsArray = await tickets.generateTickets(numOfTickets);
  let bonusTickets = [];

  if (prizeType === 'raffle') {
    let queryTickets = await tickets.generateBonusTickets(
      numOfTickets,
      {
        isFreeTicketsRates: prize.isFreeTicketsRates,
        freeTicketsRates: prize.freeTicketsRates,
      },
      generalSettings
    );

    queryTickets.forEach((ticketObject) => {
      bonusTickets.push(ticketObject);
    });
  }

  const allTickets =
    bonusTickets.length > 0
      ? newTicketsArray.concat(bonusTickets)
      : newTicketsArray;

  if (bonus) {
    const newOrder = new Order({
      tickets: allTickets,
      createdAt: new Date(),
      [prizeType]: prize._id,
      user: user._id,
      paymentStatus: Order.PaymentStatus.PENDING_BASKET,
      totalCost: 100,
      competitionId: competition._id,
      bonus: true,
    });
    return newOrder;
  }

  const newOrder = new Order({
    tickets: allTickets,
    createdAt: new Date(),
    [prizeType]: prize._id,
    user: user._id,
    paymentStatus: Order.PaymentStatus.PENDING_BASKET,
    totalCost: round(100 * ticketPrice * newTicketsArray.length),
    competitionId: competition._id,
  });

  const conversionOrder = {
    id: prize._id,
    tickets: allTickets.length,
    total: newOrder.totalCost,
    title: prize.title,
  };

  conversionAPI.setConversionAPIData(user, [conversionOrder], 'AddToCart');

  if (user.email) {
    const ordersInBasket = await Order.find({
      paymentStatus: { $in: ['PENDING_BASKET'] },
      user: user._id,
    });
    const notBoughtTickets = ordersInBasket.reduce((acc, item) => {
      return acc + item.tickets.length;
    }, 0);
    const profileId = await getKlaviyoProfileIdByEmail(user.email);
    if (profileId.length > 0) {
      await updateKlaviyoProfile(profileId, {
        'Tickets In Basket': notBoughtTickets + allTickets.length,
        'Orders In Basket': ordersInBasket.length + 1,
      });
    }
  }

  return newOrder;
};

const _createAdditionalRaffleFreeOrder = async (
  appliedCouponCompetitionId,
  userId,
  groupId,
  numOfTickets
) => {
  logger.info(`Will create additional free raffle order. Group ID: ${groupId}`);

  const activeRaffleCompetitions = await Competition.find({
    competitionType: Competition.CompetitionType.DREAMHOME,
    isActive: true,
    endsAt: {
      $gte: new Date(),
    },
    startAt: { $lte: new Date() },
  })
    .lean()
    .select('_id dreamHome');

  const queryCompetition = activeRaffleCompetitions.find(
    (x) => x._id.toString() != appliedCouponCompetitionId.toString()
  );

  if (!queryCompetition) return;

  const newTicketsArray = await tickets.generateFreeTickets(numOfTickets);

  const newOrder = new Order({
    tickets: newTicketsArray,
    createdAt: new Date(),
    raffle: queryCompetition.dreamHome,
    user: userId,
    paymentStatus: Order.PaymentStatus.FREE,
    totalCost: 0,
    competitionId: queryCompetition._id,
    groupId,
  });

  const additionalRaffleOrder = await newOrder.save();
  logger.info(
    `Additional raffle order was created. Order ID: ${additionalRaffleOrder._id}`
  );
};

const _createFreeOrder = async (coupon, userId, groupId) => {
  logger.info(
    `Will create free order. User ID: ${userId}, order group ID: ${groupId}`
  );

  let prizeType = '';
  let activeCompetition = {};

  switch (coupon.type) {
    case 'PRIZE':
      prizeType = 'prize';
      activeCompetition = await Competition.findOne({
        competitionType: coupon.type,
        isActive: true,
      })
        .lean()
        .select('_id');
      break;

    case 'FIXED_ODDS':
      prizeType = 'fixedOdds';
      activeCompetition = await Competition.findOne({
        competitionType: coupon.type,
        isActive: true,
        fixedOdds: coupon.fixedOdds,
      })
        .lean()
        .select('_id');
      break;

    case 'DREAMHOME':
      prizeType = 'raffle';
      activeCompetition = await Competition.findOne({
        competitionType: coupon.type,
        isActive: true,
        dreamHome: coupon.raffle,
      })
        .lean()
        .select('_id');
      break;

    default:
      break;
  }

  const newTicketsArray = await tickets.generateFreeTickets(coupon.value);

  if (!activeCompetition) {
    logger.error('Competition not found');
    return;
  }

  const newOrder = new Order({
    tickets: newTicketsArray,
    createdAt: new Date(),
    [prizeType]: coupon[prizeType],
    user: userId,
    paymentStatus: Order.PaymentStatus.FREE,
    totalCost: 0,
    competitionId: activeCompetition._id,
    groupId,
  });

  const orderToReturn = {
    tickets: newTicketsArray,
    [prizeType]: coupon[prizeType],
    totalCost: 0,
  };

  if (prizeType === 'fixedOdds') {
    let fixedOdds = await FixedOdds.findById(coupon[prizeType]);
    fixedOdds.ticketsBought = fixedOdds.ticketsBought + newTicketsArray.length;
    if (fixedOdds.ticketsBought > fixedOdds.maxTickets) {
      return;
    }
    await fixedOdds.save();
  }

  const freeOrder = await newOrder.save();

  logger.info(`Free order created: ${freeOrder._id}`);

  if (prizeType === 'raffle') {
    await _createAdditionalRaffleFreeOrder(
      activeCompetition._id,
      userId,
      groupId,
      coupon.value
    );
  }
  return orderToReturn;
};

const create = async (input) => {
  const order = await _createOrder(
    input.numOfTickets,
    input.accessor,
    input.prizeType,
    input.prizeId,
    input.bonus
  );

  const savedOrder = await order.save();

  logger.info(`Order ${savedOrder._id} was created`);

  return {
    message: 'Order created!',
    orderId: savedOrder._id,
  };
};

const _updateTotalTickets = async (user, numOfTickets) => {
  user.totalTicketsBought += numOfTickets;
  let ordersInBasket = [];
  ordersInBasket = await Order.find({
    paymentStatus: { $in: ['PENDING_BASKET'] },
    user: user._id,
  });
  const notBoughtTickets = ordersInBasket.reduce((acc, item) => {
    return acc + item.tickets.length;
  }, 0);
  const profileId = await getKlaviyoProfileIdByEmail(user.email);
  if (profileId.length > 0) {
    await updateKlaviyoProfile(profileId, {
      'Total Tickets Bought': user.totalTicketsBought,
      'Tickets In Basket': notBoughtTickets,
      'Orders In Basket': ordersInBasket.length,
    });
  }
  logger.info(`User's total tickets updated. User's object ${user}`);
  return user.save();
};

const _makeCreditObject = async (creditsRates, order) => {
  let spentCredits = 0;

  if (order.appliedCredits && order.appliedCredits.length > 0) {
    order.appliedCredits.forEach((creditObject) => {
      spentCredits += creditObject.spentAmount;
    });
  }

  const payedAmount = order.totalCost - spentCredits;
  let queryCreditRate = _filterCreditRates(creditsRates, payedAmount);

  if (!queryCreditRate) return null;

  const expiredDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const credit = new Credit({
    user: order.user,
    createdDate: new Date(),
    description: `Bought ${order.tickets.length} for £${order.totalCost / 100}`,
    amount: parseInt(Math.round((payedAmount * queryCreditRate.percent) / 100)),
    expiredDate: expiredDate,
    arrival: Credit.ArrivalWay.BOUGHT,
    order: order._id,
  });

  return credit;
};

const _addEarnedCredits = async (orders = []) => {
  const now = new Date().getTime();
  let creditsArray = [];
  let ordersWithActiveCredits = [];
  let ordersWithDisActiveCredits = [];

  orders.forEach((x) => {
    let prizeField = _getPrizeTypeOfOrder(x);

    if (!prizeField) return;

    if (!x[prizeField].isCreditsActive) {
      ordersWithDisActiveCredits.push(x);
      return;
    }

    if (x[prizeField].isCreditsActive && !x[prizeField].isCreditsPermanent) {
      const creditsStartDate = new Date(
        x[prizeField].creditsStartDate
      ).getTime();

      const creditsEndDate = new Date(x[prizeField].creditsEndDate).getTime();

      const nowInRange = creditsStartDate < now && now < creditsEndDate;

      if (!nowInRange) {
        ordersWithDisActiveCredits.push(x);
        return;
      }
    }

    ordersWithActiveCredits.push(x);
  });

  if (ordersWithDisActiveCredits.length) {
    const generalSettings = await GeneralSettings.findOne()
      .select('isCreditsRates creditsRates')
      .lean();

    if (generalSettings.isCreditsRates) {
      for (let i = 0; i < ordersWithDisActiveCredits.length; i++) {
        const creditObject = await _makeCreditObject(
          generalSettings.creditsRates,
          ordersWithDisActiveCredits[i]
        );
        if (creditObject) {
          creditsArray.push(creditObject);
        }
      }
    }
  }

  if (ordersWithActiveCredits.length) {
    for (let i = 0; i < ordersWithActiveCredits.length; i++) {
      let prizeField = _getPrizeTypeOfOrder(ordersWithActiveCredits[i]);
      if (!prizeField) return;

      const creditObject = await _makeCreditObject(
        ordersWithActiveCredits[i][prizeField].creditsRates,
        ordersWithActiveCredits[i]
      );
      if (creditObject) creditsArray.push(creditObject);
    }
  }

  if (creditsArray.length) {
    await credits.createMany(creditsArray);
  }
};

const _calculateSpentCredits = (spentCredits = []) => {
  const result = spentCredits.reduce((accumulator, creditObject) => {
    return (accumulator += creditObject.spentAmount);
  }, 0);

  return result;
};

const _sendReceiptMail = async (orders = [], input) => {
  let order = {
    tickets: [],
    dreamHomeTotalCost: 0,
    prizeTotalCost: 0,
    oddsTotalCost: 0,
    selectedCharity: null,
  };

  let dreamHomeTickets = [];
  let prizesTickets = [];
  let oddsTickets = [];

  orders.forEach((x) => {
    if (x.hasOwnProperty('raffle') || Array.isArray(x)) {
      order.type = 'raffle';
      if (!Array.isArray(x)) {
        x.tickets.forEach((ticket) => {
          dreamHomeTickets.push(ticket);
        });
        const spentCredits = _calculateSpentCredits(x.appliedCredits);
        order.dreamHomeTotalCost += x.totalCost - spentCredits;
        order.prizeId = x.raffle._id;
      } else {
        x.forEach((orderr) => {
          if (orderr.raffle._id) {
            order.prizeId = orderr.raffle._id;
          }
          orderr.tickets.forEach((ticket) => {
            dreamHomeTickets.push(ticket);
          });
        });
      }
    }

    if (x.hasOwnProperty('prize')) {
      order.type = 'prize';
      x.tickets.forEach((ticket) => {
        prizesTickets.push(ticket);
      });
      const spentCredits = _calculateSpentCredits(x.appliedCredits);
      order.prizeTotalCost += x.totalCost - spentCredits;
      order.prizeId = x.prize._id;
    }

    if (x.hasOwnProperty('fixedOdds')) {
      order.type = 'fixedOdds';
      x.tickets.forEach((ticket) => {
        oddsTickets.push(ticket);
      });
      const spentCredits = _calculateSpentCredits(x.appliedCredits);
      order.oddsTotalCost += x.totalCost - spentCredits;
      order.prizeId = x.fixedOdds._id;
    }
  });

  order.selectedCharity = orders[0].selectedCharity;

  const receiptData = {};

  receiptData.email = input.accessor.email;
  receiptData.firstName = input.accessor.name;
  receiptData.referralKey = input.accessor.referralKey;

  receiptData.dreamHomeTickets = dreamHomeTickets;
  receiptData.dreamHomeTotalCost = order.dreamHomeTotalCost / 100;
  receiptData.hasDreamHomeTickets = dreamHomeTickets.length > 0;

  receiptData.prizesTickets = prizesTickets;
  receiptData.prizeTotalCost = order.prizeTotalCost / 100;
  receiptData.hasPrizesTickets = prizesTickets.length > 0;

  receiptData.oddsTickets = oddsTickets;
  receiptData.oddsTotalCost = order.oddsTotalCost / 100;
  receiptData.hasOddsTickets = oddsTickets.length > 0;

  receiptData.selectedCharity = order.selectedCharity
    ? order.selectedCharity.split(/(?=[A-Z])/).join(' ')
    : 'None Selected';

  receiptData.url = `${process.env.WEB_APP_URL}`;
  receiptData.prizeInfoUrl = `${process.env.WEB_APP_URL}/profile/prizeInfo/${order.type}/${order.prizeId}`;

  let enterPhoneToken;
  let addPhoneUrl;

  if (!input.accessor.phone) {
    enterPhoneToken = await tokens.generate(
      { email: input.accessor.email },
      null,
      {
        subject: 'phone number',
      }
    );
    addPhoneUrl = await `${
      process.env.WEB_APP_URL
    }/enter-phone/${encodeURIComponent(enterPhoneToken)}`;
  }

  const socialLinks = createSocialLinks.createLinks(receiptData);
  receiptData.urlIconWhatsApp = socialLinks.urlIconWhatsApp;
  receiptData.urlIconTwitter = socialLinks.urlIconTwitter;
  receiptData.urlIconFacebook = socialLinks.urlIconFacebook;
  receiptData.twitterUrl = socialLinks.twitterUrl;
  receiptData.faceBookUrl = socialLinks.faceBookUrl;
  receiptData.whatsAppUrl = socialLinks.whatsAppUrl;
  receiptData.addPhoneUrl = addPhoneUrl;
  receiptData.buttonLogo = `${process.env.WEB_APP_URL}/extensions/images/download-btn.png`;
  receiptData.urlApp =
    'https://apps.apple.com/gb/app/raffle-house/id1543402141';
  let template = await mail.renderTemplate('receipt', receiptData);

  const data = {
    to: receiptData.email,
    subject: 'Entry receipt',
    body: template,
    bcc: process.env.TRUSTPILOT_INVITE_BCC,
  };

  return await mail.send(data);
};

const _getCountTicketsOfQueryPrize = (orders = [], prize = '') => {
  const ticketsCount = orders
    .filter((x) => {
      return x.hasOwnProperty(prize);
    })
    .reduce((accumulator, order) => {
      return (accumulator += order.tickets.length);
    }, 0);

  return ticketsCount;
};

const _updateIntercomUserTicketsData = async (
  userEmail,
  orderEntriesBought,
  orders = []
) => {
  const raffleTicketsCount = _getCountTicketsOfQueryPrize(orders, 'raffle');
  const lifeStyleTicketsCount = _getCountTicketsOfQueryPrize(orders, 'prize');
  const oddsTicketsCount = _getCountTicketsOfQueryPrize(orders, 'fixedOdds');

  intercomClient.client.users.find({ email: userEmail }).then((data) => {
    let fixOddsTotalOnIntercom = 0;
    let lifeStyleTotalOnIntercom = 0;
    let entriesBoughtOnIntercom = 0;
    let entriesboughteastlakeOnIntercom = 0;
    let queryIntercomUser = null;

    if (data.body && data.body.users && data.body.users.length > 0) {
      queryIntercomUser = data.body.users[0];
    }

    if (!queryIntercomUser) return;

    if (queryIntercomUser && queryIntercomUser.custom_attributes) {
      fixOddsTotalOnIntercom =
        queryIntercomUser.custom_attributes.fixedOddsTotal || 0;
      lifeStyleTotalOnIntercom =
        queryIntercomUser.custom_attributes.lifeStyleTotal || 0;
      entriesBoughtOnIntercom =
        queryIntercomUser.custom_attributes.entriesBought || 0;
      entriesboughteastlakeOnIntercom =
        queryIntercomUser.custom_attributes.entriesboughteastlake || 0;
    }

    intercomClient.client.users.update({
      email: queryIntercomUser.email,
      custom_attributes: {
        entriesBought: entriesBoughtOnIntercom + orderEntriesBought,
        entriesboughteastlake:
          entriesboughteastlakeOnIntercom + raffleTicketsCount,
        fixedOddsTotal: fixOddsTotalOnIntercom + oddsTicketsCount,
        lifeStyleTotal: lifeStyleTotalOnIntercom + lifeStyleTicketsCount,
      },
    });
  });
};

const _makeQueryToUpdateFixedOddsInVerify = (orders = []) => {
  let queryArray = [];

  orders.forEach((order) => {
    let checkFixedOdd = order.hasOwnProperty('fixedOdds');

    if (checkFixedOdd) {
      let queryObject = {
        updateOne: {
          filter: { _id: order.fixedOdds },
          update: { $inc: { ticketsBought: order.tickets.length } },
        },
      };
      queryArray.push(queryObject);
    }
  });

  return queryArray;
};

const _checkAppliedCoupon = async (orderGroupId, userId, orderTotalPrice) => {
  logger.info(`Will check coupon. Order group ID: ${orderGroupId}`);

  const userCoupon = await CouponUser.findOne({
    ordersGroupId: orderGroupId,
  }).populate('coupon');

  if (!userCoupon || !userCoupon.coupon) {
    logger.warn(
      `Coupon not found in _checkAppliedCoupon method. Group ID: ${orderGroupId}`
    );
    return { freeOrder: false, couponResult: false };
  }

  const queryCoupon = userCoupon.coupon;

  if (orderTotalPrice < queryCoupon.basketAmount) {
    logger.warn(
      `Insufficient orderTotalPrice to apply the coupon ${queryCoupon._id}`
    );
    return { freeOrder: false, couponResult: false };
  }

  if (queryCoupon.type === Coupon.type.CREDIT) {
    const credit = new Credit({
      user: userId,
      createdDate: new Date(),
      description: `Got for a coupon`,
      amount: parseInt(Math.round((orderTotalPrice * queryCoupon.value) / 100)),
      expiredDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      arrival: Credit.ArrivalWay.COUPON,
      coupon: queryCoupon._id,
    });

    await credit.save();
  }

  if (
    queryCoupon.type === Coupon.type.PRIZE ||
    queryCoupon.type === Coupon.type.FIXED_ODDS ||
    queryCoupon.type === Coupon.type.DREAMHOME
  ) {
    const freeOrder = await _createFreeOrder(queryCoupon, userId, orderGroupId);
    return {
      freeOrder,
      couponResult: queryCoupon,
    };
  }

  return { freeOrder: {}, couponResult: queryCoupon };
};

const _addRaffleFreeOrders = async (orders = [], userId, orderGroupId) => {
  logger.info(`Will add raffle free orders. GroupId: ${orderGroupId}`);

  const freeOrdersData = [];

  orders.forEach((order) => {
    const typeOfOrder = _getPrizeTypeOfOrder(order);
    if (typeOfOrder === 'raffle') {
      freeOrdersData.push({
        raffle: order.raffle._id,
        numberOfTickets: order.tickets.length,
        isFromLanding: order.isFromLanding,
      });
    }
  });
  if (freeOrdersData.length === 0) return;

  const activeRaffles = await Raffle.find({
    $and: [
      { active: true },
      {
        endsAt: {
          $gte: new Date(),
        },
      },
      {
        startAt: { $lte: new Date() },
      },
    ],
  })
    .select('endsAt name title property')
    .populate({ path: 'property', select: 'galleryImages' })
    .lean()
    .sort({ endsAt: 1 });

  const activeCompetitions = (
    await Competition.find({ isActive: true }).lean()
  ).filter((c) => c.hasOwnProperty('dreamHome'));

  const ordersToInsert = [];

  for (let i = 0; i < freeOrdersData.length; i++) {
    const newTickets = await tickets.generateFreeTickets(
      freeOrdersData[i].numberOfTickets
    );

    let queryDreamHome;

    if (freeOrdersData[i].isFromLanding && activeRaffles.length == 1) {
      queryDreamHome = activeRaffles.find(
        (x) => x._id.toString() == freeOrdersData[i].raffle.toString()
      );
    } else {
      queryDreamHome = activeRaffles.find(
        (x) => x._id.toString() != freeOrdersData[i].raffle.toString()
      );
    }

    if (!queryDreamHome) {
      logger.warn(`Second DreamHome not found`);
      return;
    }

    const competition = activeCompetitions.find(
      (x) => x.dreamHome.toString() === queryDreamHome._id.toString()
    );

    if (queryDreamHome && competition) {
      const newOrder = {
        tickets: newTickets,
        createdAt: new Date(),
        raffle: queryDreamHome._id,
        user: userId,
        paymentStatus: Order.PaymentStatus.FREE,
        totalCost: 0,
        competitionId: competition._id,
        groupId: orderGroupId,
      };

      if (freeOrdersData[i].isFromLanding) {
        ordersToInsert.push({ ...newOrder, isFromLanding: true });
      } else {
        ordersToInsert.push(newOrder);
      }
    }
  }

  await Order.insertMany(ordersToInsert);

  logger.info(`Raffle free orders were created. GroupId: ${orderGroupId}`);
  return ordersToInsert;
};

const verify = async (input) => {
  logger.warn(`Will verify orders with groupId ${input.reference}.`);

  let orders = await Order.find({
    groupId: input.reference,
    user: input.accessor._id,
    paymentStatus: Order.PaymentStatus.IN_PAYMENT_PROCESS,
  })
    .lean()
    .populate('fixedOdds prize raffle');

  if (!orders.length) {
    logger.warn(`No order found.`);
    throw new errors.BadRequestError('NO_ORDER_FOUND');
  }

  const conversionOrders = orders.reduce((agg, order) => {
    const prize = order.prize || order.fixedOdds || order.raffle;
    const conversionOrder = {
      id: prize._id,
      tickets: order.tickets.length,
      total: order.totalCost,
      title: prize.title,
    };
    agg.push(conversionOrder);
    return agg;
  }, []);

  conversionAPI.setConversionAPIData(
    input.accessor,
    conversionOrders,
    'Purchase',
    input.reference
  );

  const queryToUpdateOdds = _makeQueryToUpdateFixedOddsInVerify(orders);

  const queryToUpdateOrders = _makeQueryToUpdateOrders(
    orders,
    input.payment_id,
    input.transactionId
  );

  const queryToUpdateCredits = _makeQueryToUpdateCredits(orders);

  if (queryToUpdateOdds.length > 0) {
    await FixedOdds.bulkWrite(queryToUpdateOdds);
  }

  if (queryToUpdateOrders.length > 0) {
    await Order.bulkWrite(queryToUpdateOrders);
  }

  if (queryToUpdateCredits.length > 0) {
    await Credit.bulkWrite(queryToUpdateCredits);
  }

  let entriesBought = 0;
  let paid = 0;
  orders.forEach((order) => {
    entriesBought += order.tickets.length;
    const creditsSpent = order.appliedCredits.reduce((acc, item) => {
      return (acc += item.spentAmount);
    }, 0);
    paid += order.totalCost - creditsSpent;
  });

  //check referral
  if (
    input.accessor.referredBy &&
    input.accessor.spentMoney < input.accessor.neededSpend
  ) {
    await users.successfullReferral(input.accessor, paid);
  }

  await _updateTotalTickets(input.accessor, entriesBought);

  const freeRaffleOrders = await _addRaffleFreeOrders(
    orders,
    input.accessor._id,
    input.reference
  );

  const { freeOrder, couponResult } = await _checkAppliedCoupon(
    input.reference,
    input.accessor._id,
    paid
  );

  if (freeOrder) {
    orders.push(freeOrder);
  }

  if (freeRaffleOrders) {
    orders.push(freeRaffleOrders);
  }

  if (!couponResult || couponResult.type != Coupon.type.CREDIT) {
    await _addEarnedCredits(orders);
  }

  await _sendReceiptMail(orders, input);
  await _updateIntercomUserTicketsData(
    input.accessor.email,
    entriesBought,
    orders
  );

  if (input.accessor.email) {
    let items = [];
    orders.forEach((order) => {
      if (!Array.isArray(order)) {
        const creditsSpent = order.appliedCredits.reduce((acc, item) => {
          return (acc += item.spentAmount);
        }, 0);
        const prize = order.prize || order.fixedOdds || order.raffle;
        items.push({
          'Order Id': order._id ? order._id : 'FREE',
          Tickets: order.tickets.length,
          'Name Of Prize': prize.title,
          'Prize Id': prize._id,
          'Total Cost': (order.totalCost - creditsSpent) / 100,
        });
      } else {
        return order.forEach((freeOrder) => {
          items.push({
            Tickets: freeOrder.tickets.length,
            'Prize Id':
              freeOrder.raffle || freeOrder.fixedOdds || freeOrder.raffle,
            'Total Cost': freeOrder.totalCost,
            'Order Status': 'FREE',
          });
        });
      }
    });
  }

  logger.info(`Order has been accepted. Group ID: ${input.reference}`);

  return {
    status: 'OK',
    message: 'Order has been accepted',
    paidAmount: paid,
  };
};

const _makeQueryToUpdateOrders = (orders = [], checkoutId) => {
  let queryOrderArray = [];

  const keyTransactionId = 'checkoutId';
  const valueTransactionID = checkoutId;

  orders.forEach((order) => {
    let setObjectInOrder = {
      paymentStatus: Order.PaymentStatus.ACCEPTED,
      spentCredits: order.spentCredits,
      [keyTransactionId]: valueTransactionID,
      purchaseDate: new Date(),
    };

    if (order.appliedCredits && order.appliedCredits.length > 0) {
      let totalSpentCredit = order.appliedCredits.reduce(
        (accumulator, appliedCredit) => {
          return accumulator + appliedCredit.spentAmount;
        },
        0
      );

      setObjectInOrder.spentCredits += totalSpentCredit;
    }

    let queryOrderObject = {
      updateOne: {
        filter: { _id: order._id },
        update: {
          $set: setObjectInOrder,
        },
      },
    };

    queryOrderArray.push(queryOrderObject);
  });

  return queryOrderArray;
};

const _makeQueryToUpdateCredits = (orders = []) => {
  let queryCreditArray = [];

  orders.forEach((order) => {
    if (order.appliedCredits && order.appliedCredits.length > 0) {
      order.appliedCredits.forEach((creditObject) => {
        queryCreditArray.push({
          updateOne: {
            filter: { _id: creditObject.creditId },
            update: {
              $inc: {
                spent: creditObject.spentAmount,
                holdAmount: -creditObject.spentAmount,
              },
            },
          },
        });
      });
    }
  });

  return queryCreditArray;
};

module.exports = {
  create,
  verify,
};
