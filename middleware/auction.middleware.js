const BAOBAB_RPC_URL = 'https://api.baobab.klaytn.net:8651/';
const CONTRACTS = require('../config/auction.contracts');
const AUCTION = require('../config/auction.account');

/*ABI*/
const Caver = require('caver-js')
const caver = new Caver(BAOBAB_RPC_URL)
const keyring = caver.wallet.keyring.createFromPrivateKey(AUCTION.PRIVATE_KEY);
caver.wallet.add(keyring);

const auctionContract = new caver.contract(CONTRACTS.DEPLOYED_ABI_AUCTION, CONTRACTS.DEPLOYED_ADDRESS_AUCTION);
const contentContract = new caver.contract(CONTRACTS.DEPLOYED_ABI_CONTENT, CONTRACTS.DEPLOYED_ADDRESS_CONTENT);


/*lib*/
const transactions = require('../lib/transactions');


async function _genRawTX(_to, _data) {
    const rawTX = new caver.transaction.feeDelegatedSmartContractExecution({
        from: keyring.address,
        to: _to,
        gas: 2000000,
        data: _data
    })
    await caver.wallet.sign(keyring.address, rawTX);
    return rawTX.getRawTransaction();
}

async function startAuction(auctionMeta) {
    const metaRawTX = await _genRawTX(
        CONTRACTS.DEPLOYED_ADDRESS_AUCTION,
        auctionContract.methods.auctionCreate(
            auctionMeta.name,
            auctionMeta.timestamp,
            auctionMeta.minPrice,
            auctionMeta.nft,
            auctionMeta.desc,
            auctionMeta.contentCreator,
            auctionMeta.contentOwner,
            auctionMeta.owner,
            CONTRACTS.DEPLOYED_ADDRESS_NFT
        ).encodeABI()
    )
    const rlpTXResult = await transactions.sendingRLPTx("createAucFD", metaRawTX); //non-replication
    return rlpTXResult;
}

async function cancelAuction(rawTX) {
    const rlpTXResult = await transactions.sendingRLPTx("cancelAucFD", rawTX); //non-replication
    return rlpTXResult
}

async function bidding(rawTX) {
    const biddingRlp = await transactions.sendingRLPTx("bidAucFD", rawTX); //non-replicate
    console.log('FD_BIDDING     ' + biddingRlp);
    return biddingRlp
}


async function checkValidDelegation(nft) {
    const cert = await contentContract.methods.getOwnershipCert(nft).call();
    const delegate = cert.delegations.account.toLowerCase();
    if (delegate != AUCTION.ADDRESS) return false;
    else return true;
}

async function isExistingBid(auctionID) {
    const bidLen = await auctionContract.methods.getBidsCount(auctionID).call();
    if (bidLen != 0) return true;
    else return false;
}

async function isContentOwner(sender, auctionID) {
    const auction = await auctionContract.methods.getAuctionInfo(auctionID).call();
    const contentOwner = auction[9];
    if (contentOwner.toLowerCase() != sender) return false;
    else return true;
}


async function fix_getAcutionID() {
    const aucs = await auctionContract.methods.getAuctions().call();
    const lastestAUC = aucs[aucs.length - 1];
    const auctionID = lastestAUC.id;
    console.log(auctionID)
    return auctionID;
}

module.exports = {
    startAuction,
    cancelAuction,
    bidding,
    checkValidDelegation,
    isExistingBid,
    isContentOwner,
    fix_getAcutionID
}