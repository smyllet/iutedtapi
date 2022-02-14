const { webkit} = require('playwright')
const cheerio = require('cheerio')

const config = require('../config.json')
const Logs = require("./Logs");

class EDTManager {
    static async scrapAllEDT() {
        try {
            Logs.info(`Récupération de tout l'emploi du temps`)

            const browser = await webkit.launch()
            const context = await browser.newContext()
            const page = await context.newPage()

            await page.goto(`https://cas.iut.univ-paris8.fr/login?service=https%3a%2f%2fent.iut.univ-paris8.fr%2f`)

            await page.fill("#username", config.iut.username)
            await page.fill("#password", config.iut.password)

            await page.click("text=SE CONNECTER")

            // récupération Emploi du temps
            await page.goto(`https://ent.iut.univ-paris8.fr/edt/presentations.php`)

            await page.screenshot({path: "lastCalendarView.png"})
            await page.click("#selectsem-button")

            let availableDate = cheerio.load(await page.content())("#selectsem-menu").html().split(">").filter(el => el.includes("</li")).map(el => el.replace('</li', ''))

            let days = []
            for(const stringDate of availableDate) {
                let splitDate = stringDate.split('/')
                let dayDate = splitDate[0]
                let monthDate = splitDate[1]
                let yearDate = splitDate[2]
                let mondayDate = new Date(yearDate, monthDate-1, dayDate, 0, 0)

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


                        let profEtSalle = el.split(`<span class="plageHG">`)
                        let profLettre = profEtSalle[1].split("</span>")[0]
                        let profName = profList.find(prof => prof.includes(`[${profLettre}]`))
                        day.prof = (profName) ? profName.toUpperCase() : (profEtSalle.length < 3) ? "Autonomie" : profLettre
                        day.salle = profEtSalle[profEtSalle.length-1].split("</span>")[0].split("&")[0]

                        let style = el.split("style=\"")[1].split("\"")[0].split(";")

                        day.debut = mondayDate.getTime()/1000
                        day.debut += 24 * 60 * 60 * style.find(s => s.includes("margin-left")).split(':')[1].split("%")[0]/80*4
                        day.debut += 60 * (style.find(s => s.includes("top")).split(':')[1].split("px")[0]-30+480)

                        day.debutText = (new Date(day.debut * 1000)).toLocaleString()

                        day.fin = day.debut
                        day.fin += 60 * (style.find(s => s.includes("height")).split(':')[1].split("px")[0])

                        day.finText = (new Date(day.fin * 1000)).toLocaleString()

                        return day
                    })
                }

                days = days.concat(edtDays)
            }

            return days.sort((a, b) => a.debut - b.debut)
        } catch (e) {
            Logs.error(e)
            return null
        }
    }
}

module.exports = EDTManager
