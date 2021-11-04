
const DID = require('../config/did.config')

/* did-auth client */
const KlayDIDClient = require('klay-did-auth');
const klayDID = new KlayDIDClient({
  network: DID.NETWORK,
  regABI: DID.REG_ABI,
  regAddr: DID.ADDRESS
});


//       // const authResults = await klayDID.didAuth(did, keyID, signature, signData);

async function checkDIDAuth(did, keyID, signature, signData) {
    // const authResults = await klayDID.didAuth(did, keyID, signature, signData);
    // const isValid = authResults[0];
  return true;
}


module.exports = {
    checkDIDAuth,
}