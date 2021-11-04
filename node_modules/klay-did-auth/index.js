const Caver = require("caver-js");
const Auth = require("./auth");
const secp256k1 = require('secp256k1');
const {randomBytes} = require('crypto');
const {Keccak} = require('sha3');
const hash = new Keccak(256);


module.exports = class KlayDidClient {

  /**
   * @param cfg {
   *  network: blockchain endpoint
   *  regABI: did reg abi path 
   *  regAddr: did reg address
   * }  */
  constructor(cfg) {
    this.caver = new Caver(cfg.network);
    this.auth = new Auth(this.caver);
    this.didReg = new this.caver.contract(require(cfg.regABI), cfg.regAddr);
  }


  /**
   * @returns returnMsg{statusCode, msg}
   * @return statusCode
   *           -1: Login is required!    -2: error.msg
   *            1: success  */
  async createDocument(){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.create().send({from: from, gas: gas});

      return this._returnMsg(1,'Success create document');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }
  }


  /**
   * @param type: 'EcdsaSecp256k1RecoveryMethod2020' or 'EcdsaSecp256k1VerificationKey2019'
   * @returns {privateKey, publicKey or account}, error {privateKey: 0x00}  */
  creatPairKey(type){
      if(type == 'EcdsaSecp256k1RecoveryMethod2020'){
        const result = this.caver.klay.accounts.create();
        return{
          privateKey: result.privateKey,
          account:  result.address
        }
      }else if(type == 'EcdsaSecp256k1VerificationKey2019'){
        let privKey
        do {
          privKey = randomBytes(32);
        } while (!secp256k1.privateKeyVerify(privKey))
        const pubKey = secp256k1.publicKeyCreate(privKey);

        return {
          privateKey: '0x'+Buffer.from(privKey).toString('hex'),
          publicKey: Buffer.from(pubKey).toString('hex')
        };
      }

      return {
        privateKey: '0x00',
        publicKey: '0',
      };
  }


  /**
  * @dev 
  * @param signature: 0x{hex string}
  * @param data:  data contained in signature
  * @param pubKey: A public key object{id, keyType, pubKeyData} in document public key list
  * @returns Bool: **/
  isValidSign (signature, data, pubKey){
    if(pubKey.keyType == 'EcdsaSecp256k1RecoveryMethod2020')
        return this._isValid_Secpk1_Recovery2020(signature, data, pubKey.pubKeyData);
    else if(pubKey.keyType == 'EcdsaSecp256k1VerificationKey2019')
        return this._isValid_Secpk1_2019(signature, data, pubKey.pubKeyData);
    return false;
  }

  /**
  * @dev 
  * @param did: did
  * @param pubKeyID: ID of the key you are looking for in the document
  * @param signature: 0x{hex string}
  * @param data:  data contained in signature
  * @returns [isValid, errMsg] **/
  async didAuth(did, pubKeyID, signature, data ){
    const dom = await this.getDocument(did);

    if(dom.contexts.length == 0){
      return [false, 'There is no document for the did in registry'];
    }
        
    const pubKey = this.extractPubKey(dom, pubKeyID);
    if(pubKey == null){
      return [false, 'Public key does not exist in this did document'];
    }

    const isValid = this.isValidSign(signature, data, pubKey);
    if(!isValid){
      return [false, 'Did not valid'];
    }else{
      return [true, ''];
    }
  }


  /**
  * @dev
  * @param data: (string)
  * @param type: 'EcdsaSecp256k1RecoveryMethod2020' or 'EcdsaSecp256k1VerificationKey2019'
  * @param privateKey: hex string ex. 0x (string)
  * @return signature: hex string ex. 0x (string) , VRS: {v:int, r:string, s:stirng}* */ 
  sign(data, type, privateKey){
    if(type == 'EcdsaSecp256k1RecoveryMethod2020'){
      const signObj = this.caver.klay.accounts.sign(data,privateKey);
      const vrsObj = {
        v: parseInt(Number(signObj.v)),
        r: signObj.r,
        s: signObj.s
      }
      return {
        signature: signObj.signature,
        VRS: vrsObj
      };
    }else if(type == 'EcdsaSecp256k1VerificationKey2019'){
      const data32 = hash.update(Buffer.from(data)).digest();
      const pKey = Buffer.from(privateKey.replace("0x",""),'hex');
      const sigObj = secp256k1.ecdsaSign(data32, pKey);
      return {
        signature: '0x'+Buffer.from(sigObj.signature).toString('hex'),
        VRS: null,
      };
    }
    return {
        signature: '0x00',
        VRS: null,
    };
  }


  /**
   * @param did 
   * @param delegate 
   * @returns returnMsg{statusCode, msg}
   * @return statusCode: 
   *           -1: Login is required!    -2: error.msg   1: success  */
  async setController(did, delegate){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.setController(did, delegate).send({from: from, gas: gas});

      return this._returnMsg(1,'Success set controller');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }
  }


  /**
   * @param did 
   * @param delegate
   * @param sig: {int v(ECDSA signature v), string r(ECDSA signature r), string s(ECDSA recovery id)}
   * @returns returnMsg{statusCode, msg}
   * @return statusCode: 
   *           -1: Login is required!    -2: error.msg    1: success  */  
  async setControllerBySigner(did, delegate, sig){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }
    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.setControllerBySign(did, delegate, sig.v, sig.r, sig.s).send({from: from, gas: gas});

      return this._returnMsg(1,'Success set controller');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }
  }
  

  /**
  * @param did: 'did:kt:deFF..2x'
  * @param type: EcdsaSecp256k1RecoveryMethod2020 or EcdsaSecp256k1VerificationKey2019
  * @param publicKey: klaytn account address or public key(hex string)
  * @param controller: 'did:kt:feFF..Xx' 
  * @returns returnMsg{statusCode, msg}
  * @return statusCode: 
  *           -1: Login is required!    -2: error.msg
  *           -3: Not vaild key type     1: success  */
  async addPubKey(did, type, publicKey, controller){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();

      if(type == 'EcdsaSecp256k1RecoveryMethod2020'){
        await this.didReg.methods.addAddrKey(did, publicKey, controller).send(
          {
            from: from, 
            gas: gas 
          });
      }else if(type == 'EcdsaSecp256k1VerificationKey2019'){
        await this.didReg.methods.addPubKey(did, publicKey, controller).send(
          {
            from: from, 
            gas: gas
          });
      }else{
        return this._returnMsg(-3, 'Not valid type!');
      }

      return this._returnMsg(1,'Success add pubKey');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }
  }


  /**
  * @param did: 'did:kt:deFF..2x'
  * @param type: EcdsaSecp256k1RecoveryMethod2020 or EcdsaSecp256k1VerificationKey2019
  * @param publicKey: klaytn account address or public key(hex string)
  * @param controller: 'did:kt:feFF..Xx' 
  * @param sig: {int v(ECDSA signature v), string r(ECDSA signature r), string s(ECDSA recovery id)}
  * @returns returnMsg{statusCode, msg}
  * @return statusCode: 
  *           -1: Login is required!    -2: error.msg
  *           -3: Not vaild key type     1: success */  
  async addPubKeyBySigner(did, type, publicKey, controller, sig){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();

      if(type == 'EcdsaSecp256k1RecoveryMethod2020'){
        await this.didReg.methods.addAddrKeyBySign(did, publicKey, controller, sig.v, sig.r, sig.s).send({from: from,gas: gas});
      }else if(type == 'EcdsaSecp256k1VerificationKey2019'){
        await this.didReg.methods.addPubKeyBySign(did, publicKey, controller, sig.v, sig.r, sig.s ).send({from: from, gas: gas});
      }else{
        return this._returnMsg(-3, 'Not valid type!');
      }

      return this._returnMsg(1,'Success add pubKey');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }
  }

  /**
  * @param did: 'did:kt:deFF..2x'
  * @param id: '(string) [ex. company]'
  * @param type: '(string). [ex. company type]'
  * @param endpoint: '(string) [ex. example.com]' 
  * @returns returnMsg{statusCode, msg}
  * @return statusCode: 
  *           -1: Login is required!  -2: error.msg  1: success  */    
  async addService(did, id, type, endpoint){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.addService(did, id, type, endpoint).send({from: from, gas: gas});

      return this._returnMsg(1,'Success add service');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }
  }

  /**
  * @param did: 'did:kt:deFF..2x'
  * @param id: '(string) [ex. company]'
  * @param type: '(string). [ex. company type]'
  * @param endpoint: '(string) [ex. example.com]' 
  * @param sig: {int v(ECDSA signature v), string r(ECDSA signature r), string s(ECDSA recovery id)}
  * @returns returnMsg{statusCode, msg}
  * @return statusCode: 
  *           -1: Login is required!  -2: error.msg  1: success  */      
  async addServiceBySinger(did, id, type, endpoint, sig){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.addServiceBySign(did, id, type, endpoint, sig.v, sig.r, sig.s).send({from: from, gas: gas});

      return this._returnMsg(1,'Success add service');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }
  }

  /**@dev get document for did
   * @param dom: did to find document of did in registry
   * @return document
   */
  async getDocument(did) {
    try{
      const dom = await this.didReg.methods.getDocument(did).call();
      return dom; 
    }catch{
      console.log(e);
      return {contexts:[]}
    }
  }  


  /**
   * @param did: 'did:kt:dFdd..0F'
   * @returns {msg, value: nonce} //error (msg != null)
   */
  async getNonce(did){
    try{
      const result = await this.didReg.methods.nonce(did).call();
      return {msg: null, value: result};
    }catch(e){
      return {msg: e.message, value: null};
    }
  }


  /**@dev Extract the key to be used in the did document
   * @param dom: Did document
   * @param pubKeyID: ID of the key you are looking for in the document
   * @returns pubKey info
   */
  extractPubKey(dom, pubKeyID){
    const publicKeys = dom.publicKeys;
    for(let i=0; i< publicKeys.length; i++){
      if(publicKeys[i].id ==pubKeyID){
        return publicKeys[i];
      }
    }
  }


  /**
   * @param did: 'did:kt:dFdd..0F'
   * @param pubKeyId: id excluding "did#"" of public key obj in document
   * @returns returnMsg{statusCode, msg}
   * @return statusCode: 
   *           -1: Login is required!  -2: error.msg  1: success  */    
  async revokePubKey(did, pubKeyId){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.disableKey(did, pubKeyId).send({from: from, gas: gas});

      return this._returnMsg(1,'Revoked public key');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }    
  }

  
  /**
   * @param did: 'did:kt:dFdd..0F'
   * @param pubKeyId: id excluding "did#"" of public key obj in document
   * @param sig: {int v(ECDSA signature v), string r(ECDSA signature r), string s(ECDSA recovery id)}
   * @returns returnMsg{statusCode, msg}
   * @return statusCode: 
   *           -1: Login is required!  -2: error.msg  1: success  */   
  async revokePubKeyBySinger(did, pubKeyId, sig){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.disableKey(did, pubKeyId, sig.v, sig.r, sig.s).send({from: from, gas: gas});

      return this._returnMsg(1,'Revoked public key');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }  
  }


  /**
   * @param did: 'did:kt:dFdd..0F'
   * @param scvId: id excluding "did#"" of service obj in document
   * @returns returnMsg{statusCode, msg}
   * @return statusCode: 
   *           -1: Login is required!  -2: error.msg  1: success  */  
  async revokeService(did, scvId){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.disableService(did, scvId).send({from: from, gas: gas});

      return this._returnMsg(1,'Revoke service');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }  
  }


  /**
   * @param did: 'did:kt:dFdd..0F'
   * @param scvId: id excluding "did#"" of service obj in document
   * @param sig: {int v(ECDSA signature v), string r(ECDSA signature r), string s(ECDSA recovery id)}
   * @returns returnMsg{statusCode, msg}
   * @return statusCode: 
   *           -1: Login is required!  -2: error.msg  1: success  */  
  async revokeServiceBySinger(did, scvId, sig){
    if(!this.auth.isLogin()){
      return this._returnMsg(-1,'Login is required!');
    }

    try{
      const from = this.auth.getAccount();
      const gas = this.auth.getGas();
      await this.didReg.methods.disableService(did, scvId, sig.v, sig.r, sig.s).send({from: from, gas: gas});

      return this._returnMsg(1,'Revoke service');
    }catch(e){
      return this._returnMsg(-2, e.message);
    }  
  }


  /**
   * @param statusCode: -n: failed, 1: successful
   * @param msg: result msg 
   */
  _returnMsg(statusCode, msg){
    return {status: statusCode, msg: msg };
  }


  /**
  * @dev internal function
  * @param signature: value signed file metadata with private key (0x{hex}:65byte:module->caver.klay.accounts.sign)
  * @param data: data contained in signature
  * @param pubKey: public key(address) in document (0x{Hex.toLowCase})
  */
  _isValid_Secpk1_Recovery2020(signature, data, pubKeyAddr){
    const signerAddress = this.caver.klay.accounts.recover(data, signature);
    return (pubKeyAddr == signerAddress.toLowerCase());
  }


  /**
  * @dev internal function 
  * @param signature: value signed file metadata with private key (0x{hex}:64byte:module->secp256k1)
  * @param data: data contained in signature
  * @param pubKey: public key in document (0x{Hex})
  */
  _isValid_Secpk1_2019(signature, data, pubKey){
    const pureHexKey = pubKey.replace("0x", "");
    const uint8ArrPubKey = Uint8Array.from(Buffer.from(pureHexKey,'hex'));

    const msg32 = hash.update(Buffer.from(data)).digest();
  
    const pureHexSig = signature.replace("0x","");
    const bytesSig = Buffer.from(pureHexSig,'hex'); 

    return secp256k1.ecdsaVerify(bytesSig, msg32, uint8ArrPubKey);
  }
};
