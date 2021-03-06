"use strict";

const fs = require('fs');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const utils = require('./utils.js');
const Frame = require('./frame.js');
const config = require('./config.js');

const Promise = require('bluebird');

function generateIntervalArray(){
    let arr = [];
    for(let i = config.START_SECOND; i <= config.MAX_SECOND; i += config.FRAME_INTERVAL){
        arr.push(i);
    }
    return arr;
}

/*
    1. Downloads youtube video at url
    2. Extracts frames at given intervals
    3. Processes frames and passes array into callback
    params:
        url : url of youtube video
    returns:
        promise
 */

exports.getRelevantVideoFrames = function getRelevantVideoFrames(url, logger){
    const urlId =  url.substring(url.lastIndexOf('=') + 1, url.length);
    const dir = './data/' + urlId;
    const videodir = dir + '/video';

    /* FOR TESTING PURPOSES
    */

    if(fs.existsSync(videodir + '/video.mp4')){
        logger.info("Begin extracting frames from video");
        return getFrames(dir, videodir + '/video.mp4', generateIntervalArray(), logger);
    }

    /* FOR TESTING PURPOSES
     */

    //Download youtube video
    try{
        let video = ytdl(url, { quality: config.VIDEO_QUALITY});
        video.pipe(fs.createWriteStream(videodir + '/video.mp4'));
        let percent = 0;
        video.on('progress', (chunkLength, downloaded, total) => {
            let cur = Math.ceil((downloaded / total * 100));
            if(cur > percent){
                percent = cur;
                logger.info('Youtube video download progress: ', percent + '% ');
            }
        });
        video.on('end', () => {
            logger.info("Begin extracting frames from video");
            //extract frames from downloaded video
            return getFrames(dir, videodir + '/video.mp4', generateIntervalArray(), logger);
        });
    }
    catch(e){
        logger.error('error downloading youtube video, err: ', e);
        return Promise.reject(e);
    }

};

/*
    Recursively extract frames one by one
    because its way faster this way
    https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/449
*/

const MAX_TOLERATED_FRAME_FAILURES = 20;

function getFrames(dir, file, timestamps, logger){
    let relevantFrames = [];
    let imagesdir = dir + '/images';
    let callbackCount = 0;
    let errorCount = 0;

    return new Promise((resolve, reject) => {
        (function getFrame(i){
            let timestamp = timestamps[i];

            try{
                ffmpeg(file)
                    .on('end', function(){
                        let imagePath = imagesdir + '/' + timestamp + '.png';

                        //make sure screenshot exists
                        if(fs.existsSync(imagePath)){
                            logger.info("Took frame at ", timestamp, " seconds");

                            utils.queryOcr(imagePath).then((responseBody) => {
                                let body = JSON.parse(responseBody);
                                let frame = new Frame(timestamp, imagesdir, imagePath, body);
                                if(body['regions'] && body['regions'].length > 0){
                                    logger.info('Relevant frame at %d seconds', frame.getTime());
                                    logger.debug('Frame data: ', frame);
                                    relevantFrames.push(frame);
                                }
                            }).catch((err) => {
                                errorCount++;
                                logger.error("Error during OCR for image at %s ", imagePath, ' err: ', err);
                            }).finally(() => {
                                if(errorCount > MAX_TOLERATED_FRAME_FAILURES){
                                    reject("Exceeded MAX_TOLERATED_FRAME_FAILURES");
                                }
                                callbackCount++;
                                if(callbackCount === timestamps.length){
                                    relevantFrames.sort((a, b) => {
                                        return a.getTime() - b.getTime();
                                    });
                                    logger.info("Found %d relevant frames", relevantFrames.length);
                                    logger.info('Timestamps of relevant frames', relevantFrames.map((frame) => {
                                        return frame.getTime();
                                    }));
                                    logger.debug("relevantFrames: ", relevantFrames);
                                    resolve(relevantFrames);
                                }
                            });
                        }

                        //process next frame
                        if(i + 1 < timestamps.length){
                            getFrame(i+1);
                        }
                    })
                    .screenshots({
                        count: 1,
                        timestamps: [timestamp],
                        filename: '%s.png',
                        folder: dir + '/images/',
                        size: '1920x1080'
                    });
            }
            catch(e){
                logger.error('ffmpeg error, err: ', e);
                reject(e);
            }
        })(0);
    });
}
