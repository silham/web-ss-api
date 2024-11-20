const express = require('express');
const puppeteer = require('puppeteer');
const async = require('async');
const sharp = require('sharp');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
const port = 3000;
const q = async.queue(async (task, done) => {
    try {
        const screenshot = await takeScreenshot(task);
        task.res.status(200).send(`<img src="data:image/png;base64,${screenshot}" />`);
    } catch (error) {
        console.error('Error taking screenshot:', error);
        task.res.status(500).send('Failed to take screenshot');
    }
    done();
}, 5);

app.get('/screenshot', (req, res) => {
    let url = req.query["url"];
    let viewportHeight = parseInt(req.query["viewportHeight"])
    let viewportWidth = parseInt(req.query["viewportWidth"])
    let delay = parseInt(req.query["delay"])
    let scroll = parseInt(req.query["scroll"])
    let fullPage = req.query["fullPage"]

    if (!url) {
        return res.status(400).send('URL is required');
    }

    q.push({ url, viewportWidth, viewportHeight, delay, scroll, fullPage, res });
});

app.get('/generate-mockup-from-ulr', async (req, res) => {
    let { url, templatePath, delay, scroll_mobile, scroll_desktop } = req.query;
    
    if ( !url || !templatePath ) {
        return res.status(400).send('missing parameters');
    }
    try{
        const templateData = require(templatePath);
        let screenshots = []
        for(device of templateData.devices){
            const {d_name, d_type, d_width, d_height, d_real_width, d_top, d_left, d_layer } = device;
            const d_real_height = parseInt(d_real_width) * parseInt(d_height) / parseInt(d_width);
            const scroll = scroll_mobile ? d_type == "mobile" : scroll_desktop;
            console.log(url)
            const screenshot = await takeScreenshot({
                url: url,
                viewportWidth: parseInt(d_real_width),
                viewportHeight: parseInt(d_real_height),
                delay: parseInt(delay),
                scroll: parseInt(scroll),
                fullPage: false
              });
            screenshots.push({base64Image: screenshot, top: d_top, left: d_left, width: d_width, order: d_layer})
        }
        const mockup = await combineImages( screenshots, templateData.path )
        res.set('Content-Type', 'image/png');
        res.send(mockup);
    } catch (error) {
        res.status(500).send(error.message)
    }
})

app.post('/combine-images', async (req, res) => {
    return res.status(503).send('This servies is temporily unavailable')
    try {
        const { base64Screenshots, templatePath } = req.body;

        if (!base64Screenshots || !templatePath) {
            return res.status(400).send('Missing required fields: base64Screenshot and/or templatePath');
        }

        const finalImageBase64 = await combineImages(base64Screenshots, templatePath);
        res.send({ base64Image: finalImageBase64 });
    } catch (error) {
        res.status(500).send(error.message);
    }
});


async function takeScreenshot({ url, viewportWidth = 800, viewportHeight = 600, delay = 0, scroll = 0, fullPage = false }) {
    console.log(viewportWidth, viewportHeight )
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setViewport({ width: viewportWidth, height: viewportHeight });
    await page.goto(url, { waitUntil: 'networkidle2' });

    if (delay > 0) {
        await sleep(delay);
    }

    if (scroll) {
        await page.evaluate(() => {
            window.scrollTo(0, scroll);
        });
        await sleep(1000);
    }

    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: fullPage });
    await browser.close();
    return screenshot;
}

async function combineImages(screenshots, templatePath) {
    try {
        // Read the mockup template from the given path
        const templateFullPath = path.resolve(templatePath);
        const templateBuffer = fs.readFileSync(templateFullPath);

        let compositeImages = [];

        for (const screenshot of screenshots) {
            const { base64Image, top, left, width, order } = screenshot;
            console.log(width)
            // Convert base64 screenshot to buffer
            const screenshotBuffer = Buffer.from(base64Image, 'base64');

            // Resize the screenshot if needed (adjust resizing as necessary)
            const resizedScreenshotBuffer = await sharp(screenshotBuffer)
                .resize({ width: width }) // Adjust the width according to your mockup template
                .toBuffer();

            compositeImages.push({ input: resizedScreenshotBuffer, top, left, order });
        }

        // Sort composite images by order
        compositeImages.sort((a, b) => a.order - b.order);

        // Composite the images onto the template
        const finalImageBuffer = await sharp(templateBuffer)
            .composite(compositeImages)
            .png()
            .toBuffer();

        const resizedImageBuffer = await sharp(finalImageBuffer)
            .resize({ width: 1920 })
            .toBuffer();

        return resizedImageBuffer;
    } catch (error) {
        console.error('Error combining images:', error);
        throw new Error('Error combining images');
    }
}


function sleep(time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
}

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});