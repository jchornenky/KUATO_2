const moment = require('moment');

const queueService = require('./queue.service');
const logger = require('../util/logger');

const Job = require('../models/job.model');
const AuthSchema = require('../models/auth.model');
const ReportSchema = require('../models/report.model');
const SearchQuery = require('../models/searchQuery.model');

module.exports = {
    /**
     *
     * @param {string} jobId
     * @param {string} url
     * @return {Promise<Job>}
     */
    addUrlToJob: (jobId, url) => new Promise((resolve, reject) => {
        Job.findById(jobId)
            .then((job) => {
                if (!job) {
                    return reject({ status: 404, message: `Job not found with id ${jobId}` });
                }

                job.urls.push(url);
                return job.save()
                    .then((data) => resolve(data))
                    .catch((err) => reject({
                        status: 500,
                        message: err.message || 'Some error occurred while saving the Job.'
                    }));
            })
            .catch((err) => {
                if (err.kind === 'ObjectId') {
                    return reject({ status: 404, message: `Job not found with id ${jobId}` });
                }
                return reject({ status: 500, message: `Error saving job with id ${jobId}` });
            });
    }),
    /**
     *
     * @param {string} jobId
     * @param {string} url
     * @return {Promise<Job>}
     */
    deleteUrlFromJob: (jobId, url) => new Promise((resolve, reject) => {
        Job.updateOne({ _id: jobId }, { $pull: { url } })
            .then((job) => resolve(job))
            .catch((err) => {
                if (err.kind === 'ObjectId') {
                    return reject({ status: 404, message: `Job not found with id ${jobId}` });
                }
                return reject({ status: 500, message: `Error saving job with id ${jobId}` });
            });
    }),
    /**
     *
     * @param {string} jobId
     * @param {Object} searchQueryData
     * @param {AuthSchema} auth
     * @param {string} searchQueryData.name
     * @param {string} searchQueryData.type
     * @param {string} searchQueryData.query
     * @param {string} searchQueryData.reason
     * @param {string} searchQueryData.severity
     * @return {Promise<Job>}
     */
    addSearchQueryToJob: (jobId, searchQueryData, auth) => new Promise((resolve, reject) => {
        const searchQuery = new SearchQuery({
            name: searchQueryData.name,
            type: searchQueryData.type,
            query: searchQueryData.query,
            reason: searchQueryData.reason,
            severity: searchQueryData.severity,
            createdByAuthId: auth.id
        });

        Job.updateOne({ _id: jobId }, { $push: { searchQueries: searchQuery } })
            .then((job) => resolve(job))
            .catch((err) => {
                if (err.kind === 'ObjectId') {
                    return reject({ status: 404, message: `Job not found with id ${jobId}` });
                }
                return reject({ status: 500, message: `Error saving job with id ${jobId}` });
            });
    }),
    /**
     *
     * @param {string} jobId
     * @param {string} searchQueryId
     * @return {Promise<Job>}
     */
    deleteSearchQueryFromJob: (jobId, searchQueryId) => new Promise((resolve, reject) => {
        Job.updateOne({ _id: jobId }, { $pull: { searchQueries: { _id: searchQueryId } } })
            .then((job) => resolve(job))
            .catch((err) => {
                if (err.kind === 'ObjectId') {
                    return reject({ status: 404, message: `Job not found with id ${jobId}` });
                }
                return reject({ status: 500, message: `Error saving job with id ${jobId}` });
            });
    }),
    /**
     * Send given job data to rabbit mq.
     * @param {string} jobId
     * @return {Promise<boolean>}
     */
    queueJob: (jobId) => queueService.sendToJobQueue(jobId),
    /**
     * Send all currently available jobs to rabbit mq.
     * @return {Promise<number>}
     */
    queueAvailableJobs: () => new Promise((resolve, reject) => {
        Job.find({
            active: true,
            frequency: { $exists: true, $ne: '0' },
            dueAt: { $lte: moment() }
            // ,
            // $or: [
            //     { lastRunAt: { $lt: moment().subtract(15, 'minute') } },
            //     { lastRunAt: { $exists: false } }
            // ]
        })
            .then((jobs) => {
                for (const job of jobs) {
                    try {
                        if (job.frequency.endsWith('h')) {
                            const frequency = parseInt(job.frequency.replace('h', ''), 10);
                            const duration = moment.duration(moment(job.lastRunAt).diff(moment()));
                            const hours = duration.asHours();

                            if (!job.lastRunAt || hours >= frequency) {
                                queueService.sendToJobQueue(job.id).then().catch();
                                job.lastRunAt = moment();
                                job.save();
                            }
                        }
                        else if (job.frequency.endsWith('m')) {
                            const frequency = parseInt(job.frequency.replace('m', ''), 10);
                            const duration = moment.duration(moment().diff(moment(job.lastRunAt)));
                            const minutes = duration.asMinutes();
                            if (!job.lastRunAt || minutes >= frequency) {
                                queueService.sendToJobQueue(job.id).then().catch();
                                job.lastRunAt = moment();
                                job.save();
                            }
                        }
                        else if (job.frequency === '1') {
                            // frequency 1 means it is a runOnce job, set the frequency to 0 after sending it to queue
                            queueService.sendToJobQueue(job.id).then().catch();
                            job.lastRunAt = moment();
                            job.frequency = '0';
                            job.save();
                        }
                    }
                    catch (err) {
                        logger.error('unable to queue job', err);
                    }
                }
            })
            .catch(reject);
    }),
    /**
     * Get multiple jobs.
     * @param {String[]} jobIds
     * @returns {Promise<Job[]>}
     */
    getJobs: (jobIds) => new Promise((resolve, reject) => {
        Job.find({ _id: { $in: jobIds } })
            .then((jobs) => resolve(jobs))
            .catch((err) => {
                if (err.kind === 'ObjectId') {
                    return reject({ status: 404, message: `Jobs not found with ids ${jobIds}` });
                }
                return reject({ status: 500, message: `Error finding jobs with id ${jobIds}` });
            });
    })
};
