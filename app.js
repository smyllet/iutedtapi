const http = require('http')
const config = require('./config.json')
const EDTManager = require("./class/EDTManager");

let cache = {
    expireDate: new Date(),
    data: []
}

const requestListener = async function (req, res) {
    res.writeHead(200, {"Content-Type": "application/json"});

    if(cache.expireDate > new Date()) {
        res.end(JSON.stringify(cache.data))
    } else {
        let json = await EDTManager.scrapAllEDT(new Date())
        cache.data = json
        cache.expireDate = new Date((new Date().getTime()/1000 + 3600)*1000)
        res.end(JSON.stringify(json))
    }
}

const server = http.createServer(requestListener);
server.listen(config.http.port, config.http.host, () => {
    console.log(`Server is running on http://${config.http.host}:${config.http.port}`);
})


