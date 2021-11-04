const DEFAULT_GAS = '20000000'

module.exports = class Account{
    /**
     * @param caver : caver instacne
     */
    constructor(caver){
        this.caver = caver;
        this.gas = DEFAULT_GAS;
    }

    setGas(gas){
        this.gas = gas;
    }

    getGas(){
        return this.gas;
    }

    /**
     * @param keyInfo: {path, password} or {address, privateKey} 
     */
    login(keyInfo){
        if(keyInfo.password != null){
            this._addKeystoreKeyring(keyInfo);
        }else if(keyInfo.privateKey != null){
            this._addPrivateKeyring(keyInfo);
        }else{
            console.log('Failed login');
        }
    }


    logout(){
        this.caver.wallet.remove(curAccount);
        this.curAccount = null;
    }

    isLogin(){
        return (this.curAccount==null?false:true);
    }

    getAccount(){
        return this.curAccount;
    }


    /**
     * @param {path, password} keystore 
     */
    _addKeystoreKeyring(keyInfo){
        const fs = require('fs');
        const keystore = fs.readFileSync(keyInfo.path, "utf8");
        const keyring = this.caver.wallet.keyring.decrypt(keystore, keyInfo.password);
        this.caver.wallet.add(keyring);
        this.curAccount = keyring._address;
    }

    /**
     * @param {account, privateKey} keyInfo 
     */
    _addPrivateKeyring(keyInfo){
        const keyring = this.caver.wallet.newKeyring(keyInfo.account, keyInfo.privateKey);
        this.caver.wallet.updateKeyring(keyring);
        this.curAccount = keyring._address;
    }
}
