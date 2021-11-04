/*config*/
const AUCTION = require('./config/auction.account');
const DID = require('./config/did.config')
const SQL = require('./config.mysql.config');
const CONTRACTS = require('./config/auction.contracts');

const BAOBAB_RPC_URL = 'https://api.baobab.klaytn.net:8651/';
const BCON_SERVER = 'http://203.250.77.120:8000/';
const LOCAL_ACUTION_SERVER = 'http://203.250.77.156:3002'
const LOCAL_ACUTION_SERVER_PORT = 3002;


/* did-auth client */
const KlayDIDClient = require('klay-did-auth');
const klayDID = new KlayDIDClient({
  network: DID.ADDRESS,
  regABI: DID.REG_ABI,
  regAddr: DID.ADDRESS
});


/* mysql client */
const mysql = require('mysql');
const connection = mysql.createConnection({
  host: SQL.HOST, // 호스트 주소
  user: SQL.USER, // mysql user
  password: SQL.PASSWORD,
  database: SQL.DATABASE
});
connection.connect();


/* ABI */
const Caver = require('caver-js')
const caver = new Caver(BAOBAB_RPC_URL)
const keyring = caver.wallet.keyring.createFromPrivateKey(AUCTION.PRIVATE_KEY);
caver.wallet.add(keyring);
const contentContract = new caver.contract(CONTRACTS.DEPLOYED_ABI_CONTENT, CONTRACTS.DEPLOYED_ADDRESS_CONTENT);
const auctionContract = new caver.contract(CONTRACTS.DEPLOYED_ABI_AUCTION, CONTRACTS.DEPLOYED_ADDRESS_AUCTION);


/* lib modules */
const jwt = require('./lib/validTime2Token');
const sendingRLPTx = require('./lib/transactions');
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

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(fileUpload());
// app.buyerInfoDB = new Map();
// app.auctionInfoDB = new Map();





const oldOwnerCert = await contentContract.methods.getOwnershipCert(auctionNFT).call();
console.log(oldOwnerCert);





/*한 콘텐츠에 대한 모든 권한을 판매자로 부터 양도 받을 것인 가에 대한 합의가 이루어짐*/
app.post('/transfer-auth', async (req, res) => { //non-replicate
  console.log('/transfer-auth', req.body);

  const auth = req.body;
  const signature = auth.auctionMetaSig; //auction meta 정보에 seller가 사인한 값
  const did = auth.userDID;
  const keyID = auth.keyID;
  const signData = auth.auctionMetaHash;
  const authResults = await klayDID.didAuth(did, keyID, signature, signData);
  const isValidAuth = authResults[0];

  if (!isValidAuth) res.send("The requestor's identity is not confirmed.");
  else {
    const adminAuctionSig = await klayDID.sign(
      signData,
      "EcdsaSecp256k1RecoveryMethod2020",
      AUCTION.PRIVATE_KEY);

    logger.info('Auction Service signed on the transfer of Auction authority. (adminAuctionSignature)', adminAuctionSig);
    // 옥션 서비스 did, 옥션 서비스 acc 함께 넘겨주기 -> did 생성하는거 먼저하기
    const delegation = {
      "auctionMetaHash": signData,
      "adminAuctionSig": adminAuctionSig.signature,
      "adminAuctionDID": AUCTION.SCV_DID,
      "adminAuctionAcc": AUCTION.ADDRESS
    }
    res.send(delegation);
  }
});


app.post('/start-auction', async (req, res) => { //replicate
  console.log('/start-auction');
  const auctionMeta = req.body.auctionMeta;
  const nft = auctionMeta.nft;
  const addr = auctionMeta.owner;

  // 1. 옥션 서비스는 콘텐츠 매니지먼트 컨트랙트에 접근하여 권한이 양도되었는지 확인: 콘텐츠 매니지먼트에 등록된 deligation 확인
  const cert = await contentContract.methods.getOwnershipCert(auctionMeta.nft).call();
  const delegationAddr = cert.delegations.account.toLowerCase();
  console.log(delegationAddr);
  if (delegationAddr != AUCTION.ADDRESS) res.send("error: Not valid delegation Address");


  //create a fee Delegation contract execution transaction
  const createAucTx = new caver.transaction.feeDelegatedSmartContractExecution({
    from: keyring.address, //actionAdmin service address
    to: DEPLOYED_ADDRESS_AUCTION,
    gas: 2000000,
    data: auctionContract.methods.auctionCreate(
      auctionMeta.name,
      auctionMeta.timestamp,
      auctionMeta.minPrice,
      auctionMeta.nft,
      auctionMeta.desc,
      auctionMeta.contentCreator,
      auctionMeta.contentOwner,
      auctionMeta.owner,
      DEPLOYED_ADDRESS_NFT
    ).encodeABI()
  });
  //트랜잭션 sender로써 sign하고 트랜잭션 개체에 서명을 추가
  await caver.wallet.sign(keyring.address, createAucTx);
  //RLP 인코딩된 트랜잭션 문자열
  const metaRawTransaction = createAucTx.getRawTransaction();
  //fd서버에 raw트랜잭션 전송하여 옥션 시작 메소드 실행
  const resCreateAUC = await sendingRLPTx.sendingRLPTx("createAucFD", metaRawTransaction); //non-replication
  // console.log(resCreateAUC);
  console.log('FD_CREATE_AUCTION     ' + resCreateAUC);

  setTimeout(async () => {
    const aucs = await auctionContract.methods.getAuctions().call();
    const lastestAUC = aucs[aucs.length - 1];
    const auctionID = lastestAUC.id;
    console.log('id', auctionID);

    console.log(resCreateAUC);
    if (resCreateAUC == 'success') {
      res.send('start auction...');

      //create JWT
      //const exp = auctionMeta.timestamp+'ms';
      const exp = '60000ms';
      const genJWT = await jwt.genJWT(exp, auctionMeta);
      if (!genJWT) res.send(genJWT);
      else {

        const sql = "INSERT INTO auction_info (auction_id, valid_time, valid_key, nft, user_addr,status) VALUES(?,?,?,?,?,?)";
        const params = [auctionID, genJWT.valid_time, genJWT.valid_key, nft, addr, 1];
        connection.query(sql, params, function (err, rows, fields) { //replicate
          if (err) {
            console.log(err);
            res.send('error: No value was inserted into the database....');
          }
        });

        //startMonitoring(auctionID); //non-replicate
      }

    } else {
      res.send('error: auction has not been created. ');
    };
  }, 5000);
});



app.post('/inprocess-auction', async (req, res) => { //replicate
  console.log('/inprocess-auction', req.body);
  const rawTx = req.body.senderRawTransaction; //rlp로 인코딩된 트랜잭션
  const auctionID = req.body.aucID;
  const addr = req.body.userAddr;
  const signature = req.body.contentSig;
  const did = req.body.userDID;
  const keyID = req.body.keyID;
  const contentMeta = req.body.contentMeta;
  const amount = req.body.amount;

  //@@@@@ 받아온 auctionID로 DB 옥션 정보조회  1.옥션 주인 조회 b, 2. 옥션 기한 조회 a
  const auctionSql = 'SELECT * FROM auction_info WHERE auction_id = ? ';
  connection.query(auctionSql, auctionID, async (err, result) => {
    if (err) console.log(err);
    else {
      console.log(result[0]);
      const aucAddr = result[0].user_addr;
      //const aucEXP = await jwt.verifyJWT(result[0].valid_time,result[0].valid_key);
      const signData = JSON.stringify(contentMeta);
      // const authResults = await klayDID.didAuth(did, keyID, signature, signData);
      // const isValid = authResults[0];
      // console.log(isValid);
      const isValid = true;
      if (!isValid) {
        res.send("The requestor's identity is not confirmed.");
      }
      //@@conditions@@ 옥션 주인과 req요청자가 같으면안됨
      else if (addr == aucAddr) {
        res.send("error: AUC Owner cannot bidding.");
      }
      //@@conditions@@ EXP 기한후 비딩 금지
      // else if(!aucEXP){ res.send("error: Timeout for bidding.");
      // }
      else {
        const buyerSql = 'SELECT * FROM buyer_info WHERE nft = ? ';
        connection.query(buyerSql, contentMeta[0], async (err, result) => {
          if (err) {
            console.log(err);
            res.send('error: database select error !!!');
          } else {
            if (result.length > 0) //값이 있다는 것
            {
              console.log(result);
              const updateSql = "UPDATE auction.buyer_info SET user_addr=?, user_did=?, key_id=?, content_sig=?, str_contentmeta=?, bid_amount=? WHERE nft =?";
              const params = [addr, did, keyID, signature, signData, amount, contentMeta[0]];
              connection.query(updateSql, params, async (err, rows) => { //replicate
                if (err) {
                  res.send('error: database update error !!!')
                  console.log(err);
                } else {
                  console.log('success update buyerInfo!!');
                  console.log(rows);
                }
              });
            } else {
              const insertSql = "INSERT INTO auction.buyer_info (nft,user_addr,user_did,key_id,content_sig,str_contentmeta,bid_amount) VALUES(?,?,?,?,?,?,?)";
              const params2 = [contentMeta[0], addr, did, keyID, signature, signData, amount];
              connection.query(insertSql, params2, async (err) => { //replicate
                if (err) {
                  res.send('error: database insert error !!!');
                  console.log(err);
                } else {
                  console.log('store buyerInfo!!');
                }
              });
            }
          }
        });

        /*
        인증이 완료되면, 옥션 서버가 입찰에 대한 정보를 갱신하기 위하여 auctionManagement 컨트랙트에서 tx를 보냄.
        */
        const biddingRlp = await sendingRLPTx.sendingRLPTx("bidAucFD", rawTx); //non-replicate
        console.log('FD_BIDDING     ' + biddingRlp);
        res.send('success: The bid was successful...');
      }
    }
  });
});



/@@/
app.post('/cancel-auction', async (req, res) => { //replicate
  const auctionID = req.body.aucID;
  const reqAddr = req.body.reqAddr;
  const senderRawTransaction = req.body.senderRawTransaction;

  const auction = await auctionContract.methods.getAuctionInfo(auctionID).call();
  const auctionBidLen = await auctionContract.methods.getBidsCount(auctionID).call();
  const auctionOwner = auction[9].toLowerCase();

  if (auctionBidLen != 0) { //@@conditions@@ 입찰이 없는 경우 가능
    res.send('error: There is a existing Bid');
  }else if (auctionOwner != reqAddr) { //@@conditions@@ 옥션 주인만 취소 가능
    res.send('error: Only owner can cancel');
  } else {
    const cancelRlp = await sendingRLPTx.sendingRLPTx("cancelAucFD", senderRawTransaction); //non-replication
    console.log('FD_CANCEL_AUCTION     ' + cancelRlp);

    const sql = "UPDATE auction_info SET status = 0 WHERE auction_id =?";
    connection.query(sql, [auctionID + ""], function (err) { //replicate
      if (err) {
        console.log('error: No value was updated into the database....');
        res.send('error: No value was updated into the database....');
      }
    });
    res.send("cancel success");
  }
});


/@@/
app.post('/end-auction', async (req, res) => { //replicate
  const auctionID = req.body.auctionID;
  const auctionNFT = req.body.nft;
  console.log('nft', auctionNFT);

  // //@@conditions@@ EXP 기한이 끝난 경우만 가능
  // const auc = await auctionContract.methods.getAuctionInfo(auctionID).call();
  // const aucEXP = auc[2];
  // const now = Date.parse(new Date())/1000;
  // if(aucEXP>now){
  //   res.send('error: auction is not finished');
  // }
  const isValid = true //위의 주석 풀면 이거 지우셈 임시적으로 둔거임


  if (!isValid) {
    console.log('auction is not finished');
  }else {
    const sql = "SELECT * FROM buyer_info WHERE nft =?";
    connection.query(sql, ["" + auctionNFT], async (err, buyers) => {
      if (err) {
        console.log(err);
      }
      console.log(buyers[0]);

      //트랜잭션 sender로써 sign하고 트랜잭션 개체에 서명을 추가
      //RLP 인코딩된 트랜잭션 문자열
      //fd서버에 raw트랜잭션 전송하여 옥션 시작 메소드 실행
      const sendLastBidTx = new caver.transaction.feeDelegatedSmartContractExecution({
        from: keyring.address, //actionAdmin service address
        to: DEPLOYED_ADDRESS_AUCTION,
        gas: 2000000,
        data: auctionContract.methods.sendLastBid(
          auctionID
        ).encodeABI()
      });
      await caver.wallet.sign(keyring.address, sendLastBidTx);
      const metaRawTransaction = sendLastBidTx.getRawTransaction();
      const bidRLP = await sendingRLPTx.sendingRLPTx("sendLastBidFD", metaRawTransaction); //non-replication
      console.log('FD_SEND_LASTBID     ' + bidRLP);


      //옥션 서비스가 비콘 스토리지에서 새로운 소유증명서 발급에 사용되는 이전 소유증명서를 contentManagement 컨트랙트에서 가져옴
      const oldOwnerCert = await contentContract.methods.getOwnershipCert(auctionNFT).call();

      const contentMeta = {
        'NFT': oldOwnerCert.contentMeta.NFT,
        'created': oldOwnerCert.contentMeta.created,
        'name': oldOwnerCert.contentMeta.name,
        'fileType': oldOwnerCert.contentMeta.fileType,
        'size': oldOwnerCert.contentMeta.size,
        'metaHash': oldOwnerCert.contentMeta.metaHash,
        'contentType': oldOwnerCert.contentMeta.contentType,
        'desc': oldOwnerCert.contentMeta.desc
      }
      const ownerInfo = {
        'did': oldOwnerCert.ownerInfo.did,
        'keyID': oldOwnerCert.ownerInfo.did + '#key-1', //임시
        'history': []
      }
      const storageService = {
        'storageDID': oldOwnerCert.storageSvc.storageDID,
        'downloadEndpoint': oldOwnerCert.storageSvc.downloadEndpoint,
        'accessLocation': oldOwnerCert.storageSvc.accessLocation,
        'reIssueEndpoint': oldOwnerCert.storageSvc.reIssueEndpoint,
        'storageSignature': oldOwnerCert.storageSvc.storageSignature
      }
      const oldOwnershipCert = {
        'contentMeta': contentMeta,
        'ownerInfo': ownerInfo,
        'storageService': storageService,
        'issueTime': oldOwnerCert.issueTime
      }

      //옥션 서비스가 (소유권 양도에 사용 될) 새로운 소유 증명서를 발급받기 위하여
      //   이전 소유증명서(delegation 정보 제외 후),
      //   비딩할 때 받은 [최종 입찰자의(구매자) 시그니처, 콘텐츠 메타정보, 구매자 did, public key id] 정보들을  스토리지 서비스에게 전달
      request.post({ //non-replication 
        headers: {
          'content-type': 'application/json'
        },
        url: `${BCON_SERVER}/newOwnershipCert`,
        body: {
          'oldOwnershipCert': oldOwnershipCert,
          'buyerInfo': buyers[0],
          'auctionID': auctionID
        },
        json: true
      }, function (error, res, body) {
        console.log(error);
      });
    });

    const update = "UPDATE auction_info SET status = 0 WHERE auction_id=?";
    connection.query(update, [auctionID + ""], function (err) { //replicate
      if (err) {
        console.log('error: No value was updated into the database....');
        res.send('error: No value was updated into the database....');
      }
    });
  }
});


/@@@/
app.post('/transfer-ownership', async (req, res) => { //non-replicate
  console.log('/transfer-ownership');

  const newOwnerCert = req.body.ownershipCert;
  const auctionID = req.body.auctionID;

  const sql = "SELECT * FROM auction.buyer_info WHERE nft=?";
  connection.query(sql, ["" + newOwnerCert.NFT], async (err, rows) => {
    if (err) {
      console.log('error: database select error...', err);
      res.send('error: database select error...');
    } else {
      console.log('buyer:', rows[0]);
      console.log('userAddr:', rows[0].user_addr);
      console.log('newOwnershipCert:', newOwnerCert);
      // * Fee Delegation - send last BID
      //create a fee Delegation contract execution transaction
      //트랜잭션 sender로써 sign하고 트랜잭션 개체에 서명을 추가
      //RLP 인코딩된 트랜잭션 문자열
      //fd서버에 raw트랜잭션 전송하여 옥션 시작 메소드 실행
      const changeCertTx = new caver.transaction.feeDelegatedSmartContractExecution({
        from: keyring.address, //actionAdmin service address
        to: DEPLOYED_ADDRESS,
        gas: 2000000,
        data: contentContract.methods.changeOwnershipCert(
          newOwnerCert.NFT,
          newOwnerCert.ownerDID,
          newOwnerCert.storageSignature.signature,
          newOwnerCert.issueTime,
          rows[0].user_addr, //buyer address
          CONTRACTS.DEPLOYED_ADDRESS_NFT
        ).encodeABI()
      });
      await caver.wallet.sign(keyring.address, changeCertTx);
      const metaRawTransaction = changeCertTx.getRawTransaction();
      const changeRlp = await sendingRLPTx.sendingRLPTx("changeCertFD", metaRawTransaction); //non-replicate
      console.log('FD_CHANGE_CERT    ' + changeRlp);

      //*** Fee Delegation - AUCTION done
      //트랜잭션 sender로써 sign하고 트랜잭션 개체에 서명을 추가
      //RLP 인코딩된 트랜잭션 문자열
      //fd서버에 raw트랜잭션 전송하여 옥션 종료 메소드 실행
      const auctionDoneTX = new caver.transaction.feeDelegatedSmartContractExecution({
        from: keyring.address, //actionAdmin service address
        to: DEPLOYED_ADDRESS_AUCTION,
        gas: 2000000,
        data: auctionContract.methods.auctionDone(auctionID).encodeABI()
      });
      await caver.wallet.sign(keyring.address, auctionDoneTX);
      const metaRawTx = auctionDoneTX.getRawTransaction();
      const doneRlP = await sendingRLPTx.sendingRLPTx("aucDoneFD", metaRawTx); //non-replicate
      console.log('FD_AUC_DONE     ' + doneRlP);


      await request.post({ //non-replicate
        headers: {
          'content-type': 'application/json'
        },
        url: `${LOCAL_ACUTION_SERVER}/done-auction`,
        body: {
          'auctionID': auctionID
        },
        json: true
      }, function (error, res, body) {
        //console.log(error);
      });
    }
  });

});


app.post('/done-auction', async (req, res) => { //non-replicate
  //*** Fee Delegation - AUCTION done
  console.log('/done-auction', req.body.auctionID);

  const auctionID = req.body.auctionID;
  const auctionDoneTX = new caver.transaction.feeDelegatedSmartContractExecution({
    from: keyring.address, //actionAdmin service address
    to: DEPLOYED_ADDRESS_AUCTION,
    gas: 2000000,
    data: auctionContract.methods.auctionDone(auctionID).encodeABI()
  });
  //트랜잭션 sender로써 sign하고 트랜잭션 개체에 서명을 추가
  await caver.wallet.sign(keyring.address, auctionDoneTX);
  //RLP 인코딩된 트랜잭션 문자열
  const metaRawTx = auctionDoneTX.getRawTransaction();
  //fd서버에 raw트랜잭션 전송하여 옥션 종료 메소드 실행
  const rlpTXResult = await sendingRLPTx.sendingRLPTx("aucDoneFD", metaRawTx); //non-replicate
  console.log('FD_AUC_DONE     ' + rlpTXResult);

  setTimeout(async () => {
    const auctionInfo = await auctionContract.methods.getAuctionInfo(auctionID).call();
    console.log(auctionInfo);
    console.log(`${auctionID}: change auction done!`)
  }, 4000);

  res.send(`${auctionID}: auction done!`);
});


// app.listen(LOCAL_ACUTION_SERVER_PORT, () => {
//   console.log(`auction-server is running on `, LOCAL_ACUTION_SERVER_PORT);
// });






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