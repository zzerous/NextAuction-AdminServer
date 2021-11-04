/*config*/

const BCON_SERVER = 'http://203.250.77.120:8000/';
const LOCAL_ACUTION_SERVER = 'http://203.250.77.152:3002'
const LOCAL_ACUTION_SERVER_PORT = 3002;



/* lib modules */
const jwt = require('./lib/validTime2Token');
const logger = require('./lib/winston');
const request = require('request');
global.atob = require("atob");
const moment = require('moment');
require('moment-timezone');
moment.tz.setDefault("Asia/Seoul");





/* server framework */
const express = require('express');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const cors = require('cors');
const database = require('mime-db');
const {
  result
} = require('lodash');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(fileUpload());
// app.buyerInfoDB = new Map();
// app.auctionInfoDB = new Map();



/*한 콘텐츠에 대한 모든 권한을 판매자로 부터 양도 받을 것인 가에 대한 합의가 이루어짐*/
//complete
// app.post('/transfer-auth', async (req, res) => { //non-replicate
//   console.log('/transfer-auth', req.body);

//   const auth = await klayDID.didAuth(
//     req.body.did,
//     req.body.keyID,
//     req.body.auctionMetaSig,
//     req.body.auctionMetaHash);

//   if (auth[0]) {
//     const adminSignature = await klayDID.sign(
//       req.body.auctionMetaHash,
//       "EcdsaSecp256k1RecoveryMethod2020",
//       AUCTION.PRIVATE_KEY).signature;

//     logger.info('Auction Service signed on the transfer of Auction authority. (adminAuctionSignature)', adminSignature);
//     // 옥션 서비스 did, 옥션 서비스 acc 함께 넘겨주기 -> did 생성하는거 먼저하기
//     const delegation = {
//       "auctionMetaHash": req.body.auctionMetaHash,
//       "adminAuctionSig": adminSignature,
//       "adminAuctionDID": AUCTION.SCV_DID,
//       "adminAuctionAcc": AUCTION.ADDRESS
//     }
//     res.send(delegation);
//   } else {
//     res.send("The buyer identity is not valid");
//   }
// });


auctionMiddleware = require('./middleware/auction.middleware');
databaseMiddleware = require('./middleware/database.middleware');
authMiddleware = require('./middleware/auth.middleware');

app.post('/start-auction', async (req, res) => { //replicate
  const auctionMeta = req.body.auctionMeta;
  console.log("[start auction]");


  const isValid = await auctionMiddleware.checkValidDelegation(auctionMeta.nft);
  if (!isValid) {
    res.send("error: Not valid delegation Address");
    return;
  }

  const rlpTXResult = await auctionMiddleware.startAuction(auctionMeta);
  if (rlpTXResult != 'success') {
    res.send('error: auction has not been created. ');
    return
  }

  console.log(` [NFT:${auctionMeta.nft}]`, " register auction info in auction contract..");
  setTimeout(async () => {
    /**
     * @fix setTimeout -> smart contract event
     * @fix all auciton list -> get auction ID
     */
    const auctionID = await auctionMiddleware.fix_getAcutionID();

    const token = await jwt.genJWT('60000ms', auctionMeta);
    if (!token) {
      res.send(token);
      return;
    }

    const result = await databaseMiddleware.writeAuctionInfo(auctionID, auctionMeta, token);
    if (result.status == -1) {
      res.send("failed: \n" + result.err);
      return;
    }
    console.log(` [NFT:${auctionMeta.nft}]`, " successful start auction");
    res.send("start auction: success");
  }, 5000);
});


app.post('/cancel-auction', async (req, res) => { //replicate
  const auctionID = req.body.aucID;
  const sender = req.body.reqAddr;
  const senderRawTX = req.body.senderRawTransaction;

  if (await auctionMiddleware.isExistingBid(auctionID)) {
    res.send('error: There is a existing Bid');
    return;
  }
  if (!await auctionMiddleware.isContentOwner(sender, auctionID)) {
    res.send('error: Only owner can cancel');
    return;
  }

  const rlpTXResult = await auctionMiddleware.cancelAuction(senderRawTX);
  if (rlpTXResult != 'success') {
    res.send('failed to cancel auction..');
    return
  }

  const result = await databaseMiddleware.deleteAuctionInfo(auctionID);
  if (result.status == -1) res.send('error: No value was updated into the database....\n' + result.err);
  else res.send("cancel success");

});

/**
 * @req {
 *  senderRawTransaction,
 *  aucID,
 *  userAddr,
 *  contentSig,
 *  userDID,
 *  keyID,
 *  contentMeta,
 *  amount
 * }
 */
app.post('/inprocess-auction', async (req, res) => {
  console.log('/inprocess-auction', 'buyer: ' + req.body.userAddr);
  const rawTx = req.body.senderRawTransaction; //rlp로 인코딩된 트랜잭션
  const auctionID = req.body.aucID;
  const buyerAddr = req.body.userAddr;
  const buyerDID = req.body.userDID;
  const buyerKeyID = req.body.keyID;
  const buyerSig = req.body.contentSig;
  const buyerSigData = JSON.stringify(contentMeta);
  const contentMeta = req.body.contentMeta;
  const nft = req.body.contentMeta[0];
  const amount = req.body.amount;


  const auction = await databaseMiddleware.getAuctionInfo(auctionID);
  if (auction == -1) {
    res.send(`The auction ${auctionID} could not be found`);
    return;
  }

  // const isValidAuth = authMiddleware.checkDIDAuth(
  //   buyerDID,
  //   buyerKeyID,
  //   buyerSig,
  //   buyerSigData
  // );
  // if (!isValidAuth) {
  //   res.send("The requestor's identity is not confirmed.");
  // }


  // 옥션 주인과 req요청자가 같으면안됨
  // if (buyerAddr == auction.user_addr) {
  //   res.send("error: AUC Owner cannot bidding.");
  //   return;
  // }

  // //EXP 기한후 비딩 금지
  // const isNotExpired = await jwt.verifyJWT(auction.valid_time, auction.valid_key);
  // if (!isNotExpired) {
  //   res.send("error: Timeout for bidding.");
  //   return;
  // }

  const curBuyer = await databaseMiddleware.getCurrentBuyer(nft);
  if (curBuyer == -1) {
    res.send(`Error: The buyers of ${nft} could not be found`);
    return;
  }
  console.log(curBuyer)

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

  const rlpTXResult = await auctionMiddleware.bidding(rawTx);
  if (rlpTXResult == 'success') res.send('failed to bidding..');
  else res.send('success: The bid was successful...');
})



// app.post('/end-auction', async (req, res) => { //replicate
//   const auctionID = req.body.auctionID;
//   const auctionNFT = req.body.nft;
//   console.log('nft', auctionNFT);

//   // //@@conditions@@ EXP 기한이 끝난 경우만 가능
//   // const auc = await auctionContract.methods.getAuctionInfo(auctionID).call();
//   // const aucEXP = auc[2];
//   // const now = Date.parse(new Date())/1000;
//   // if(aucEXP>now){
//   //   res.send('error: auction is not finished');
//   // }
//   const isValid = true //위의 주석 풀면 이거 지우셈 임시적으로 둔거임


//   if (!isValid) {
//     console.log('auction is not finished');
//   } else {
//     const sql = "SELECT * FROM buyer_info WHERE nft =?";
//     connection.query(sql, ["" + auctionNFT], async (err, buyers) => {
//       if (err) {
//         console.log(err);
//       }
//       console.log(buyers[0]);

//       //fd서버에 raw트랜잭션 전송하여 옥션 시작 메소드 실행
//       const sendLastBidTx = new caver.transaction.feeDelegatedSmartContractExecution({
//         from: keyring.address, //actionAdmin service address
//         to: CONTRACTS.DEPLOYED_ADDRESS_AUCTION,
//         gas: 2000000,
//         data: auctionContract.methods.sendLastBid(
//           auctionID
//         ).encodeABI()
//       });
//       await caver.wallet.sign(keyring.address, sendLastBidTx);
//       const metaRawTransaction = sendLastBidTx.getRawTransaction();
//       const bidRLP = await sendingRLPTx.sendingRLPTx("sendLastBidFD", metaRawTransaction); //non-replication
//       console.log('FD_SEND_LASTBID     ' + bidRLP);


//       //옥션 서비스가 비콘 스토리지에서 새로운 소유증명서 발급에 사용되는 이전 소유증명서를 contentManagement 컨트랙트에서 가져옴
//       const oldOwnerCert = await contentContract.methods.getOwnershipCert(auctionNFT).call();

//       const contentMeta = {
//         'NFT': oldOwnerCert.contentMeta.NFT,
//         'created': oldOwnerCert.contentMeta.created,
//         'name': oldOwnerCert.contentMeta.name,
//         'fileType': oldOwnerCert.contentMeta.fileType,
//         'size': oldOwnerCert.contentMeta.size,
//         'metaHash': oldOwnerCert.contentMeta.metaHash,
//         'contentType': oldOwnerCert.contentMeta.contentType,
//         'desc': oldOwnerCert.contentMeta.desc
//       }
//       const ownerInfo = {
//         'did': oldOwnerCert.ownerInfo.did,
//         'keyID': oldOwnerCert.ownerInfo.did + '#key-1', //임시
//         'history': []
//       }
//       const storageService = {
//         'storageDID': oldOwnerCert.storageSvc.storageDID,
//         'downloadEndpoint': oldOwnerCert.storageSvc.downloadEndpoint,
//         'accessLocation': oldOwnerCert.storageSvc.accessLocation,
//         'reIssueEndpoint': oldOwnerCert.storageSvc.reIssueEndpoint,
//         'storageSignature': oldOwnerCert.storageSvc.storageSignature
//       }
//       const oldOwnershipCert = {
//         'contentMeta': contentMeta,
//         'ownerInfo': ownerInfo,
//         'storageService': storageService,
//         'issueTime': oldOwnerCert.issueTime
//       }

//       //옥션 서비스가 (소유권 양도에 사용 될) 새로운 소유 증명서를 발급받기 위하여
//       //   이전 소유증명서(delegation 정보 제외 후),
//       //   비딩할 때 받은 [최종 입찰자의(구매자) 시그니처, 콘텐츠 메타정보, 구매자 did, public key id] 정보들을  스토리지 서비스에게 전달
//       request.post({ //non-replication 
//         headers: {
//           'content-type': 'application/json'
//         },
//         url: `${BCON_SERVER}/newOwnershipCert`,
//         body: {
//           'oldOwnershipCert': oldOwnershipCert,
//           'buyerInfo': buyers[0],
//           'auctionID': auctionID
//         },
//         json: true
//       }, function (error, res, body) {
//         console.log(error);
//       });
//     });

//     const update = "UPDATE auction_info SET status = 0 WHERE auction_id=?";
//     connection.query(update, [auctionID + ""], function (err) { //replicate
//       if (err) {
//         console.log('error: No value was updated into the database....');
//         res.send('error: No value was updated into the database....');
//       }
//     });
//   }
// });


// app.post('/transfer-ownership', async (req, res) => { //non-replicate
//   console.log('/transfer-ownership');

//   const newOwnerCert = req.body.ownershipCert;
//   const auctionID = req.body.auctionID;

//   const sql = "SELECT * FROM auction.buyer_info WHERE nft=?";
//   connection.query(sql, ["" + newOwnerCert.NFT], async (err, rows) => {
//     if (err) {
//       console.log('error: database select error...', err);
//       res.send('error: database select error...');
//     } else {
//       console.log('buyer:', rows[0]);
//       console.log('userAddr:', rows[0].user_addr);
//       console.log('newOwnershipCert:', newOwnerCert);
//       // * Fee Delegation - send last BID
//       //create a fee Delegation contract execution transaction
//       //트랜잭션 sender로써 sign하고 트랜잭션 개체에 서명을 추가
//       //RLP 인코딩된 트랜잭션 문자열
//       //fd서버에 raw트랜잭션 전송하여 옥션 시작 메소드 실행
//       const changeCertTx = new caver.transaction.feeDelegatedSmartContractExecution({
//         from: keyring.address, //actionAdmin service address
//         to: CONTRACTS.DEPLOYED_ADDRESS,
//         gas: 2000000,
//         data: contentContract.methods.changeOwnershipCert(
//           newOwnerCert.NFT,
//           newOwnerCert.ownerDID,
//           newOwnerCert.storageSignature.signature,
//           newOwnerCert.issueTime,
//           rows[0].user_addr, //buyer address
//           CONTRACTS.DEPLOYED_ADDRESS_NFT
//         ).encodeABI()
//       });
//       await caver.wallet.sign(keyring.address, changeCertTx);
//       const metaRawTransaction = changeCertTx.getRawTransaction();
//       const changeRlp = await sendingRLPTx.sendingRLPTx("changeCertFD", metaRawTransaction); //non-replicate
//       console.log('FD_CHANGE_CERT    ' + changeRlp);

//       //*** Fee Delegation - AUCTION done
//       //트랜잭션 sender로써 sign하고 트랜잭션 개체에 서명을 추가
//       //RLP 인코딩된 트랜잭션 문자열
//       //fd서버에 raw트랜잭션 전송하여 옥션 종료 메소드 실행
//       const auctionDoneTX = new caver.transaction.feeDelegatedSmartContractExecution({
//         from: keyring.address, //actionAdmin service address
//         to: CONTRACTS.DEPLOYED_ADDRESS_AUCTION,
//         gas: 2000000,
//         data: auctionContract.methods.auctionDone(auctionID).encodeABI()
//       });
//       await caver.wallet.sign(keyring.address, auctionDoneTX);
//       const metaRawTx = auctionDoneTX.getRawTransaction();
//       const doneRlP = await sendingRLPTx.sendingRLPTx("aucDoneFD", metaRawTx); //non-replicate
//       console.log('FD_AUC_DONE     ' + doneRlP);


//       await request.post({ //non-replicate
//         headers: {
//           'content-type': 'application/json'
//         },
//         url: `${LOCAL_ACUTION_SERVER}/done-auction`,
//         body: {
//           'auctionID': auctionID
//         },
//         json: true
//       }, function (error, res, body) {
//         //console.log(error);
//       });
//     }
//   });

// });


// app.post('/done-auction', async (req, res) => { //non-replicate
//   //*** Fee Delegation - AUCTION done
//   console.log('/done-auction', req.body.auctionID);

//   const auctionID = req.body.auctionID;
//   const auctionDoneTX = new caver.transaction.feeDelegatedSmartContractExecution({
//     from: keyring.address, //actionAdmin service address
//     to: CONTRACTS.DEPLOYED_ADDRESS_AUCTION,
//     gas: 2000000,
//     data: auctionContract.methods.auctionDone(auctionID).encodeABI()
//   });
//   //트랜잭션 sender로써 sign하고 트랜잭션 개체에 서명을 추가
//   await caver.wallet.sign(keyring.address, auctionDoneTX);
//   //RLP 인코딩된 트랜잭션 문자열
//   const metaRawTx = auctionDoneTX.getRawTransaction();
//   //fd서버에 raw트랜잭션 전송하여 옥션 종료 메소드 실행
//   const rlpTXResult = await sendingRLPTx.sendingRLPTx("aucDoneFD", metaRawTx); //non-replicate
//   console.log('FD_AUC_DONE     ' + rlpTXResult);

//   setTimeout(async () => {
//     const auctionInfo = await auctionContract.methods.getAuctionInfo(auctionID).call();
//     console.log(auctionInfo);
//     console.log(`${auctionID}: change auction done!`)
//   }, 4000);

//   res.send(`${auctionID}: auction done!`);
// });


app.listen(LOCAL_ACUTION_SERVER_PORT, () => {
  console.log(`auction-server is running on `, LOCAL_ACUTION_SERVER_PORT);
});






// function resMSG(auctionID,nft){
//     const time = moment().format('YYYY-MM-DD HH:mm:ss');
//     const msg = time + ', Auction ID :'+ auctionID+', NFT: '+ nft ;
//     return msg;
// }



// async function startMonitoring(auctionID) {
//   const sql = "SELECT * FROM auction.auction_info WHERE auction_id=?";
//   const params = ["" + auctionID];
//   connection.query(sql, params, function (err, rows, fields) {
//     if (err) {
//       console.log('error: database select error...');
//       res.send('error: database select error...');
//     } else {
//       const auctionInfo = rows[0];
//       const nft = auctionInfo.nft;
//       console.log('start monitoring...');
//       const auctionEndID = setInterval(async () => {
//         const validTimeKey = auctionInfo.valid_key;
//         const validTime = auctionInfo.valid_time;
//         const verifyJWT = await jwt.verifyJWT(validTime, validTimeKey);
//         if (!verifyJWT) {
//           clearInterval(auctionEndID);
//           console.log('auction end...');

//           request.post({
//             headers: {
//               'content-type': 'application/json'
//             },
//             url: `${LOCAL_ACUTION_SERVER}/end-auction`, //니서버
//             body: {
//               'auctionID': auctionID,
//               'nft': nft
//             },
//             json: true

//           }, function (error, res, body) {
//             console.log(error);
//           });
//         } else {
//           console.log('check auction state...');
//         }
//       }, 1000);
//     }
//   });
// }