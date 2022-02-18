const config = require('./config.json')
const Logs = require("./class/Logs");
const {webkit} = require("playwright");
const cheerio = require("cheerio");

/**
 * @type {Array<{edt: string, expireDate: Date, data: any[]}>}
 */
let cache = []

/**
 * @type {[{username: string, password: string, defaultEdt?: string}]}
 */
let cacheCredentials = []

const server = require('http').createServer()
const io = require('socket.io')(server, {
    cors: {
        origin: "http://localhost:4200",
        methods: ["GET", "POST"]
    }
})

function sendLogin(socket, credentials, days) {
    socket.emit('login', {
        username: credentials.username,
        edt: {
            name: credentials.defaultEdt,
            days: days
        }
    })
}

function updateEdt(socket, days) {
    socket.emit('update', days)
}

io.on('connection', (socket) => {
    console.log(`Connecté au client ${socket.id}`)
    socket.on('login', async (/** {username: string, password: string} */ credentials) => {
        try {
            let selectedEdt = ""

            // Test du cache identifiant + edt
            let credentialsFromCache = cacheCredentials.find(c => c.username === credentials.username && c.password === credentials.password && c.defaultEdt)
            if(credentialsFromCache) {
                selectedEdt = credentialsFromCache.defaultEdt
                let potentialCache = cache.find(d => d.edt === selectedEdt)
                if(potentialCache && potentialCache.expireDate > new Date()) {
                    Logs.info(`Connexion cache de ${credentials.username}`)
                    return sendLogin(socket, credentials, potentialCache.data)
                }
            }
            Logs.info(`Connexion à l'ENT de ${credentials.username}`)

            // Lancement du navigateur
            const browser = await webkit.launch()
            const context = await browser.newContext()
            const page = await context.newPage()

            // Ouverture de l'ent
            await page.goto(`https://cas.iut.univ-paris8.fr/login?service=https%3a%2f%2fent.iut.univ-paris8.fr%2f`)

            // Connexion
            await page.fill("#username", credentials.username)
            await page.fill("#password", credentials.password)
            await page.click("text=SE CONNECTER")

            // Test de succès de la connexion
            if(!(await page.title()).includes('ENT')) {
                return socket.emit('login', null)
            }

            // récupération Emploi du temps
            await page.goto(`https://ent.iut.univ-paris8.fr/edt/presentations.php`)

            selectedEdt = await ((await page.$('.ui-selectmenu-text')).innerText())
            credentials['defaultEdt'] = selectedEdt
            cacheCredentials.push(credentials)
            sendLogin(socket, credentials, [])

            // Envoi du cache si il existe
            let potentialCache = cache.find(d => d.edt === selectedEdt)
            if(potentialCache && potentialCache.expireDate > new Date()) {
                Logs.info('Récupération EDT cache')
                return updateEdt(socket, potentialCache.data)
            } else Logs.info('Récupération EDT scrapping')

            // Récupération de la liste des semaines
            await page.click("#selectsem-button")
            let availableDate = cheerio.load(await page.content())("#selectsem-menu").html().split(">").filter(el => el.includes("</li")).map(el => el.replace('</li', ''))
            let sortingDate = []

            let todayDate = new Date()
            for(const stringDate of availableDate) {
                let splitDate = stringDate.split('/')
                let dayDate = splitDate[0]
                let monthDate = splitDate[1]
                let yearDate = splitDate[2]
                let mondayDate = new Date(yearDate, monthDate-1, dayDate, 0, 0)

                sortingDate.push({
                    stringDate: stringDate,
                    mondayDate: mondayDate,
                    diff: Math.abs(mondayDate.getTime() - todayDate.getTime())
                })
            }

            sortingDate = sortingDate.sort((a, b) => a.diff - b.diff)

            let days = []

            // Pour chaque semaines disponible
            for(const data of sortingDate) {
                let stringDate = data.stringDate
                let mondayDate = data.mondayDate

                console.log(mondayDate.toLocaleDateString())

                await page.click(`#selectsem-menu>li:has-text("${stringDate}")`)
                await page.click("#selectsem-button")

                let html = await page.content()

                const $ = cheerio.load(html)

                let edtHtml = $("#quadrillage").html()
                let profList = $("#selectprof").find('option').toArray().map(el => el.children[0].data)

                let edtDays = []

                if(edtHtml.length > 0) {
                    edtDays = edtHtml.split("</div><div").map(el => {
                        if(!el.startsWith("<div")) el = "<div" + el
                        if(!el.endsWith("</div>")) el = el + "</div>"
                        return el
                    }).filter(el => {
                        return !el.includes("plageDIVn");
                    }).map(el => {
                        try {
                            let day = {}

                            try {
                                day.mat = el.split("<strong>")[1].split("</strong>")[0]
                            } catch (e) {
                                try {
                                    day.mat = el.split('<span class="plageCTRL">')[1].split("</span>")[0]
                                } catch (e) {
                                    day.mat = "Matière inconnu"
                                }
                            }


                            try {
                                let profEtSalle = el.split(`<span class="plageHG">`)
                                let profLettre = profEtSalle[1].split("</span>")[0]
                                let profName = profList.find(prof => prof.includes(`[${profLettre}]`))
                                day.prof = (profName) ? profName.toUpperCase() : (profEtSalle.length < 3) ? "Autonomie" : profLettre
                                day.salle = profEtSalle[profEtSalle.length-1].split("</span>")[0].split("&")[0]
                            } catch (e) {
                                day.prof = "Prof inconnu"
                                day.salle = "Salle inconnu"
                            }


                            let style = el.split("style=\"")[1].split("\"")[0].split(";")

                            day.debut = mondayDate.getTime()/1000
                            day.debut += 24 * 60 * 60 * style.find(s => s.includes("margin-left")).split(':')[1].split("%")[0]/80*4
                            day.debut += 60 * (style.find(s => s.includes("top")).split(':')[1].split("px")[0]-30+480)

                            day.debutText = (new Date(day.debut * 1000)).toLocaleString()

                            day.fin = day.debut
                            day.fin += 60 * (style.find(s => s.includes("height")).split(':')[1].split("px")[0])

                            day.finText = (new Date(day.fin * 1000)).toLocaleString()

                            return day
                        } catch (e) {
                            return null
                        }
                    })
                }

                days = days.concat(edtDays)
                updateEdt(socket, days)
            }
            cache.push({
                edt: selectedEdt,
                expireDate: new Date((new Date().getTime()/1000 + 3600000)*1000),
                data: days
            })
        } catch (e) {
            Logs.error(e)
            socket.emit('error')
        }
    })
})

server.listen(config.http.port, () => {
    console.log(`Server is running on http://${config.http.host}:${config.http.port}`)
})
