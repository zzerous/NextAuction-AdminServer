/* config */
const SQL = require('../config/mysql.config');

/* mysql client */
const mysql = require('mysql2/promise');
let connection = null;
async function createMysqlClient() {
    connection = await mysql.createConnection({
        host: SQL.HOST, // 호스트 주소
        user: SQL.USER, // mysql user
        password: SQL.PASSWORD,
        database: SQL.DATABASE
    });
}
createMysqlClient();

async function writeAuctionInfo(auctionID, auctionMeta, token) {
    try {
        console.log(auctionID)
        const [results] = await connection.execute(
            "INSERT INTO auction_info (auction_id, valid_time, valid_key, nft, user_addr,status) VALUES(?,?,?,?,?,?)",
            [auctionID, token.valid_time, token.valid_key, auctionMeta.nft, auctionMeta.owner, 1]
        );
        return {
            status: 1
        }
    } catch (e) {
        return {
            status: -1,
            err: e
        }
    }
}

async function deleteAuctionInfo(auctionID) {
    try {
        const [result] = await connection.execute(
            "UPDATE auction_info SET status = 0 WHERE auction_id =?",
            [auctionID + ""]);

        if (result.affectedRows != 1) {
            return {
                status: -1,
                err: 'error: No value was updated into the database..'
            }
        } else {
            return {
                status: 1
            }
        }
    } catch (e) {
        return {
            status: -1,
            err: e
        }
    }
}

async function getAuctionInfo(auctionID) {
    try {
        const [rows] = await connection.execute('SELECT * FROM auction_info WHERE auction_id = ?', [auctionID]);
        console.log(rows[0])
        if (rows[0] == undefined) return -1
        else return rows[0]
    } catch (e) {
        console.log(e)
        return -1
    }

}


async function getCurrentBuyer(nft) {
    try {
        const [rows] = await connection.execute('SELECT * FROM buyer_info WHERE nft = ?', [nft]);
        console.log('getBuyer')
        console.log(rows)
        return {
            isExist: rows.length > 0,
            buyers: rows
        };
    } catch (e) {
        console.log(e)
        return -1
    }

}


async function updateBuyer(nft, address, did, keyID, sig, sigData, amount, isExist) {
    if (isExist) {
        try {
            const result = await connection.execute(
                "UPDATE auction.buyer_info SET user_addr=?, user_did=?, key_id=?, content_sig=?, str_contentmeta=?, bid_amount=? WHERE nft =?",
                [address, did, keyID, sig, sigData, amount, nft]
            );
            return {
                status: 1
            }
        } catch (e) {
            return {
                status: -1,
                err: e
            }
        }
    } else {
        try {
            await connection.execute(
                "INSERT INTO auction.buyer_info (nft,user_addr,user_did,key_id,content_sig,str_contentmeta,bid_amount) VALUES(?,?,?,?,?,?,?)",
                [nft, address, did, keyID, sig, sigData, amount]
            );
            return {
                status: 1
            }
        } catch (e) {
            return {
                status: -1,
                err: e
            }
        }
    }
}


module.exports = {
    writeAuctionInfo,
    deleteAuctionInfo,
    getAuctionInfo,
    getCurrentBuyer,
    updateBuyer
}