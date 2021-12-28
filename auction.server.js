/*config*/
const LOCAL_ACUTION_SERVER_PORT = 3002;



/* lib modules */
const jwt = require('./lib/validTime2Token');
global.atob = require("atob");
const moment = require('moment');
require('moment-timezone');
moment.tz.setDefault("Asia/Seoul");





/* server framework */
const express = require('express');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(fileUpload());
// app.buyerInfoDB = new Map();
// app.auctionInfoDB = new Map();



////////////테스트 로그용/////////////////

/*
  test-log <- ctrl+f 해서 이걸로 찾아가면됨
*/
const fs = require('fs')
const logFolder = './log-by-auction/'

function UpdateTestLog(nft, value){
  const cur = JSON.parse(fs.readFileSync(`${logFolder}${nft}.json`, 'utf-8'));
  cur.history.push(value)
  fs.writeFileSync(`${logFolder}${nft}.json`,JSON.stringify(cur,0,4,0));
}

function CreateTestLog(auctionMeta){
  fs.writeFileSync(`${logFolder}${auctionMeta.nft}.json`, JSON.stringify({
    'auciton-nft': auctionMeta.nft,
    'seller': auctionMeta.owner,
    'start-time': new Date(),
    'auciton-meta': auctionMeta,
    'history': [],
  },0,4,0))
}
///////////////////////////////////
// app.get('/log', async(req,res)=>{
//   req.body.nft
//   read NFT.json
//   res.send(NFT.json)
// })
app.get('/log', async(req, res) => {
  const auclog = require(`./log-by-auction/${req.body.nft}.json`);
  console.log(auclog);
  res.send(auclog);
})

/********************************START*******************************************/

auctionMiddleware = require('./middleware/auction.middleware');
databaseMiddleware = require('./middleware/database.middleware');
authMiddleware = require('./middleware/auth.middleware');


/**
 * @req {
 *  did,
 *  keyID,
 *  auctionMetaSig,
 *  auctionMetaHash
 * }
 */
app.post('/transfer-auth', async (req, res) => {
  console.log('/transfer-auth', req.body);

  const isValidAuth = authMiddleware.checkDIDAuth(
    req.body.did,
    req.body.keyID,
    req.body.auctionMetaSig,
    req.body.auctionMetaHash
  )
  if (!isValidAuth) {
    res.send("The requestor's identity is not confirmed.");
    return
  }
  const adminSig = await authMiddleware.createAdminSign(req.body.auctionMetaHash);

  const delegationInfo = authMiddleware.createDelegationInfo(
    req.body.auctionMetaHash,
    adminSig
  )
  res.send(delegationInfo)
});



/**
 * @req {
 *  auctionMeta.name,
 *  auctionMeta.timestamp,
 *  auctionMeta.minPrice,
 *  auctionMeta.nft,
 *  auctionMeta.desc,
 *  auctionMeta.contentCreator,
 *  auctionMeta.contentOwner,
 *  auctionMeta.owner,
 * }
 */
app.post('/start-auction', async (req, res) => { //replicate
  const auctionMeta = req.body.auctionMeta;
  console.log("/start auction");

  const isValid = await auctionMiddleware.checkValidDelegation(auctionMeta.nft);
  if (!isValid) {
    res.send("error: Not valid delegation Address");
    return;
  }

  const rlpTXResult = await auctionMiddleware.startAuction(auctionMeta);
  console.log(rlpTXResult)
  if (rlpTXResult != 'success') {
    res.send('error: auction has not been created. ');
    return
  }

  /*test-log*/
  CreateTestLog(auctionMeta)

  console.log(` [NFT:${auctionMeta.nft}]`, " register auction info in auction contract..");
  setTimeout(async () => {
    const auctionID = await auctionMiddleware.getAuctionID(auctionMeta.nft);
    if (auctionID == -1) {
      res.send('error: failed to get auction id');
      return;
    }

    const token = await jwt.genJWT('60000ms', auctionMeta);
    if (!token) {
      res.send(token);
      return;
    }

    const result = await databaseMiddleware.createAuction(auctionID, auctionMeta, token);
    if (result.status == -1) {
      res.send("failed: \n" + result.err);
      return;
    }

    const auctionInfo = await databaseMiddleware.getAuctionInfo(auctionID)
    //auctionMiddleware.startMonitoring(auctionID, auctionInfo, jwt)


    console.log(` [NFT:${auctionMeta.nft}]`, " successful start auction");
    res.send("start auction: success");
  }, 5000);
});


/**
 * @req {
 *  aucID, reqAddr, senderRawTransaction
 * }
 */
app.post('/cancel-auction', async (req, res) => { //replicate
  console.log(
    '/cancel-auction ',
    `sender: ${req.body.reqAddr}`,
    `auctionID: ${req.body.aucID}`);

  const auctionID = req.body.aucID;
  const seller = req.body.reqAddr;
  const sellerRawTX = req.body.senderRawTransaction;

  if (await auctionMiddleware.isExistingBid(auctionID)) {
    res.send('error: There is a existing Bid');
    return;
  }

  if (!await auctionMiddleware.isContentOwner(seller, auctionID)) {
    res.send('error: Only owner can cancel');
    return;
  }


  const rlpTXResult = await auctionMiddleware.cancelAuction(sellerRawTX);
  if (rlpTXResult != 'success') {
    res.send('failed to cancel auction..');
    return
  }


  const result = await databaseMiddleware.endAuction(auctionID);
  if (result.status == -1) res.send('error: No value was updated into the database....\n' + result.err);
  else res.send("cancel success");


});



/**
 * @req {
 *  senderRawTransaction, aucID, userAddr
 *  userDID, keyID, contentSig, 
 *  contentMeta, amount
 * }
 */
app.post('/inprocess-auction', async (req, res) => {
  console.log('/inprocess-auction','buyer: ' + req.body.userAddr);
  console.log(req.body);
  const rawTx = req.body.senderRawTransaction; //rlp로 인코딩된 트랜잭션
  const auctionID = req.body.aucID;
  const buyerAddr = req.body.userAddr;
  const buyerDID = req.body.userDID;
  const buyerKeyID = req.body.keyID;
  const buyerSig = req.body.contentSig;
  const buyerSigData = JSON.stringify(req.body.contentMeta);
  const nft = req.body.contentMeta[0];
  const amount = req.body.amount;


  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][Bidding][${buyerAddr}][start: bidding, amount ${amount}]`)

  const auction = await databaseMiddleware.getAuctionInfo(auctionID);
  if (auction == -1) {
    res.send(`The auction ${auctionID} could not be found`);
    return;
  }

  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][Bidding][${buyerAddr}][get auction info...]`)


  const isValidAuth = await authMiddleware.checkDIDAuth(
    buyerDID,
    buyerKeyID,
    buyerSig,
    buyerSigData
  );


  if (!isValidAuth) {
    res.send("The requestor's identity is not confirmed.");
    return
  }

  if (auctionMiddleware.isEqualSeller(auction, buyerAddr)) {
    res.send("error: AUC Owner cannot bidding.");
    return;
  }

  if (auctionMiddleware.isBiggerthanLast(auction, amount)){
    res.send("error: bidding price smaller than last bidding");
    return;
  }

  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][Bidding][${buyerAddr}][buyer did-auth: success]`)

  /**
   * @test_ignore
   */
  // if (!auctionMiddleware.isNotExpired(auction)) {
  //   res.send("error: Timeout for bidding.");
  //   return;
  // }

  const curBuyer = await databaseMiddleware.getCurrentBuyer(nft);
  if (curBuyer == -1) {
    res.send(`Error: The buyers of ${nft} could not be found`);
    return;
  }
  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][Bidding][${buyerAddr}][get current buyer in local db]`)


  const updated = await databaseMiddleware.updateBuyer(
    nft,
    buyerAddr,
    buyerDID,
    buyerKeyID,
    buyerSig,
    buyerSigData,
    amount,
    curBuyer.isExist
  )
  if (updated.status == -1) {
    res.send('error: update buyer in DB');
    return;
  }
  console.log(`updated to bidding: ${buyerAddr}`)

  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][Bidding][${buyerAddr}][update latest bidding in local db]`)

  const rlpTXResult = await auctionMiddleware.bidding(rawTx);
  if (rlpTXResult != 'success') res.send('failed to bidding..');
  else res.send('success: The bid was successful...');

  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][Bidding][${buyerAddr}][bidding operation in auction contract ]`)
  UpdateTestLog(nft, `[${auctionID}][Bidding][${buyerAddr}][bidding success-end ]`)
})

/**
 * @req {
 *  auctionID, nft
 * }
 */
app.post('/end-auction', async (req, res) => {
  console.log('/end-auciton', `nft: ${req.body.nft}`);

  console.log(req.body);
  const nft = req.body.nft;
  const auctionID = req.body.auctionID;

  /**
   * @test_ignore
   */
  // if (!await auctionMiddleware.isAuctionEnd(auctionID)) {
  //   res.send('auction is not finished');
  //   return;
  // }

  const buyerInfo = await databaseMiddleware.getCurrentBuyer(nft);
  if (buyerInfo == -1) {
    res.send(`Not existing buyer in auction[${auctionID}]`);
    return;
  }

  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][ENDAuction][${buyerInfo.buyers[0].user_addr}][get current buyer in local db]`)  

  const rlpTXResult = await auctionMiddleware.sendLastBidding(auctionID)
  if (rlpTXResult != 'success') {
    res.send('failed to last bidding..');
    return
  }
  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][ENDAuction][${buyerInfo.buyers[0].user_addr}][send last bid to seller]`)  

  const oldOwnerCert = await auctionMiddleware.getOldOwnerCert(nft);
  if (oldOwnerCert == -1) {
    res.send('Failed to get old ownershipcert..');
    return
  }

  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][ENDAuction][${buyerInfo.buyers[0].user_addr}][get oldOwnerCert in contract]`)  
  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][ENDAuction][${oldOwnerCert.ownerInfo.did}][ownerAddress in oldOwnerCert]`)  

  await auctionMiddleware.askNewOwnershipCert(auctionID, buyerInfo.buyers[0], oldOwnerCert);

  const result = await databaseMiddleware.endAuction(auctionID);
  if (result.status == -1) res.send('error: No value was updated into the database....\n' + result.err);
  else res.send("end success");

  /*test-log*/
  UpdateTestLog(nft, `[${auctionID}][ENDAuction][${buyerInfo.buyers[0].user_addr}][change auction state end in local db]`)  

})




/**
 * @req {
 *  ownershipCert, auctionID
 * }
 */
app.post('/transfer-ownership', async (req, res) => {
  console.log('/transfer-Ownership')
  const newOwnerCert = req.body.ownershipCert;
  const auctionID = req.body.auctionID;

  const buyerInfo = await databaseMiddleware.getCurrentBuyer(newOwnerCert.NFT + "");

  /*test-log*/
  UpdateTestLog(newOwnerCert.NFT, `[${auctionID}][TransferOwner][${buyerInfo}][get current buyer in local db]`)  

  console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@ new cert ');
  console.log(newOwnerCert);
  console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@ buyer infot ');
  console.log(buyerInfo.buyers[0]);

  const rlpTXResult_change = await auctionMiddleware.changeOwnerCert(newOwnerCert, buyerInfo.buyers[0].user_addr);
  if (rlpTXResult_change != 'success') {
    res.send('failed to change cert..');
    console.log("change cert success @@@@@@@@@@@@@@@@@@@@@@@@@@@@")
    return
  }
  /*test-log*/
  UpdateTestLog(newOwnerCert.NFT, `[${auctionID}][TransferOwner][${buyerInfo}][update new ownercert]`)  

  console.log("auc done request  @@@@@@@@@@@@@@@@@@@@@@@@@@@@")
  const rlpTXResult_done = await auctionMiddleware.doneAuction(auctionID);
  if (rlpTXResult_done != 'success') {
    res.send('failed to done auction in auction management..');
    console.log("auc done succcesss @@@@@@@@@@@@@@@@@@@@@@@@@@@@")
    return
  }
  /*test-log*/
  UpdateTestLog(newOwnerCert.NFT, `[${auctionID}][TransferOwner][${buyerInfo}][change auction state end]`)  


  console.log("auc done succcesss @@@@@@@@@@@@@@@@@@@@@@@@@@@@")
  await auctionMiddleware.requestDoneAuction(auctionID);
  console.log(
    `[auction:${auctionID}-transfer ownership]`,
    `[nft-${newOwnerCert.NFT}, new owner buyer]:${buyerInfo.buyers[0].user_addr}`);

  /*test-log*/
  UpdateTestLog(newOwnerCert.NFT, `[${auctionID}][TransferOwner][${buyerInfo}][reqeust change auction state]]`)  

  });


/**
 * auctionID
 */
app.post('done-auction', async (req, res) => {
  console.log('done-auction', req.body.auctionID);

  //fix why? duplicate? -> transfer-ownership
  const rlpTXResult_done = await auctionMiddleware.doneAuction(auctionID);
  if (rlpTXResult_done != 'success') {
    res.send('failed to done auction in auction management..');
    return
  }

  // /*test-log*/
  // UpdateTestLog(nft, `[${auctionID}][DoneAuction]][${buyerInfo}][change auction state end]`)  

  await auctionMiddleware.printAuctionEnd(auctionID);
  res.send(`${auctionID}: auction done!`);
})



app.listen(LOCAL_ACUTION_SERVER_PORT, () => {
  console.log(`auction-server is running on `, LOCAL_ACUTION_SERVER_PORT);
});


