const moment = require('moment');

const Job = require('../models/job.model.js');
const services = require('../services');
const logger = require('../util/logger');
const defs = require('../constants');

exports.create = (req, res) => {
    if (!req.body.searchQueries || req.body.searchQueries.length === 0) {
        return res.status(500).send({
            message: 'Please specify at least one search query'
        }).end();
    }

    const { auth } = req.data;
    const urls = req.body.urlsString ? req.body.urlsString.split('\n') : [];

    const job = new Job({
        name: req.body.name || `Unnamed Job ${moment().format()}`,
        notifications: req.body.notifications,
        searchQueries: req.body.searchQueries,
        active: req.body.active || true,
        frequency: req.body.frequency,
        dueAt: req.body.dueAt ? moment(req.body.dueAt) : moment(),
        urls,
        createdByAuthId: auth.id
    });

    // if the job is set to an instance run, save the job as active
    if (req.body.isInstant === defs.job.scheduleOptions.RUN_NOW) {
        job.active = true;
        job.dueAt = moment();
        job.status = defs.job.status.RUNNING;
    }

    // if the job is a run once job set the frequency to 1
    if (req.body.isRunOnce === defs.job.frequencyOptions.RUN_ONCE || !req.body.frequency) {
        job.frequency = '1';
    }
    else if (req.body.isRunOnce === defs.job.frequencyOptions.NOT_GONNA_RUN) {
        job.frequency = '0';
    }

    return job.save()
        .then((data) => {
            res.send(data);
        })
        .catch((err) => {
            res.status(500).send({
                message: err.message || 'Some error occurred while creating the Job.'
            });
        });
};

exports.findAll = (req, res) => {
    const { status, jobDate } = req.query;
    const condition = {};

    if (status && status !== '') {
        condition.status = status;
    }

    switch (jobDate) {
    case 'TODAY':
        condition.updatedAt = { $gt: moment().startOf('day') };
        break;
    case 'YESTERDAY':
        condition.updatedAt = { $gt: moment().startOf('day').subtract(1, 'day') };
        break;
    case 'LAST_WEEK':
        condition.updatedAt = { $gt: moment().startOf('day').subtract(7, 'day') };
        break;
    case 'LAST_MONTH':
        condition.updatedAt = { $gt: moment().startOf('day').subtract(1, 'month') };
        break;
    case 'OLDER':
    default:
        break;
    }

    Job.find(condition)
        .sort({ _id: -1 })
        .limit(100)
        .then((jobs) => {
            res.send(jobs);
        })
        .catch((err) => {
            res.status(500).send({
                message: err.message || 'Some error occurred while retrieving jobs.'
            });
        });
};

exports.findOne = (req, res) => {
    const { jobId } = req.params;
    logger.info(`jobs; findOne #${jobId}`);
    Job.findById(jobId)
        .then((job) => {
            if (!job) {
                return res.status(404).send({
                    message: `Job not found with id ${req.params.jobId}`
                });
            }
            return res.send(job);
        })
        .catch((err) => {
            if (err.kind === 'ObjectId') {
                return res.status(404).send({
                    message: `Job not found with id ${req.params.jobId}`
                });
            }
            return res.status(500).send({
                message: `Error retrieving job with id ${req.params.jobId}`
            });
        });
};

exports.update = (req, res) => {
    if (!req.body.searchQueries || req.body.searchQueries.length === 0) {
        return res.status(500).send({
            message: 'Please specify at least one search query'
        }).end();
    }

    const { auth } = req.data;
    const job = req.body;
    job.updatedByAuthId = auth.id;
    job.urls = req.body.urlsString ? req.body.urlsString.split('\n') : [];

    // if the job is set to an instance run, save the job as active
    if (req.body.isInstant) {
        job.active = true;
        job.dueAt = moment();
        job.status = defs.job.status.RUNNING;
    }

    // if the job is a run once job set the frequency to 1
    if (req.body.isRunOnce) {
        job.frequency = '1';
    }

    return Job.replaceOne({ _id: job.id }, job)
        .then((result) => {
            res.send(result);
        })
        .catch((err) => {
            res.status(500).send({
                message: err.message || 'Some error occurred while updating the Job.'
            });
        });
};

exports.activate = (req, res) => {
    const { auth } = req.data;
    const { jobId } = req.params;

    Job.updateOne({ _id: jobId }, { active: true, status: defs.job.status.INIT, updatedByAuthId: auth.id })
        .then((result) => {
            res.send(result);
        })
        .catch((err) => {
            res.status(500).send({ message: err.message || 'Some error occurred while updating the Job.' });
        });
};

exports.deactivate = async (req, res) => {
    const { auth } = req.data;
    const { jobId } = req.params;

    let job = await Job.findById(jobId);
    if (!job) {
        return res.status(404).send({ message: `Job not found with id ${jobId}` });
    }

    // check if the job is running or not, if running do not delete
    if (defs.job.noDeactivateStatusList.indexOf(job.status) !== -1) {
        return res.status(400).send({ message: 'Can not deactivate a running or already deactivated job' });
    }

    try {
        const result = await Job.updateOne({ _id: jobId }, {
            active: false,
            status: defs.job.status.DEACTIVATED,
            updatedByAuthId: auth.id
        });

        res.send(result);
    }
    catch (err) {
        res.status(500).send({ message: err.message || 'Some error occurred while updating the Job.' });
    }
};

exports.delete = async (req, res) => {
    const { jobId } = req.params;

    let job = await Job.findById(jobId);
    if (!job) {
        return res.status(404).send({ message: `Job not found with id ${jobId}` });
    }

    // check if the job is running or not, if running do not delete
    if (defs.job.noDeleteStatusList.indexOf(job.status) !== -1) {
        return res.status(400).send({ message: 'Can not delete a running job' });
    }

    try {
        job = await Job.findByIdAndRemove(jobId);
    }
    catch (err) {
        if (err.kind === 'ObjectId' || err.name === 'NotFound') {
            return res.status(404).send({ message: `Job not found with id ${jobId}` });
        }
        return res.status(500).send({ message: `Could not delete job with id ${jobId}` });
    }

    if (!job) {
        return res.status(404).send({ message: `Job not found with id ${jobId}` });
    }

    return res.send({ message: 'Job deleted successfully!' });
};

exports.queueAvailable = (req, res) => {
    services.job.queueAvailableJobs().then().catch();
    return res.status(200).send({ message: 'ok' });
};

exports.addUrl = (req, res) => {
    // todo Validate request
    const { jobId } = req.params;
    const { url } = req.body;

    logger.info(`jobs; addUrl #${jobId}`);
    services.job.addUrlToJob(jobId, url)
        .then((job) => res.status(200).send(job))
        .catch((reason) => res.status(reason.status).send({ message: reason.message }));
};

exports.deleteUrl = (req, res) => {
    // todo Validate request
    const { jobId } = req.params;
    const { url } = req.body;

    logger.info(`jobs; deleteUrl #${jobId}`);
    services.job.deleteUrlFromJob(jobId, url)
        .then((job) => res.status(200).send(job))
        .catch((reason) => res.status(reason.status).send({ message: reason.message }));
};

exports.addSearchQuery = (req, res) => {
    // todo Validate request
    const { jobId } = req.params;
    const searchQueryData = req.body;

    logger.info(`jobs; addSearchQuery #${jobId}`);
    services.job.addSearchQueryToJob(jobId, searchQueryData, req.data.auth)
        .then((job) => res.status(200).send(job))
        .catch((reason) => res.status(reason.status).send({ message: reason.message }));
};

exports.deleteSearchQuery = (req, res) => {
    // todo Validate request
    const { jobId } = req.params;
    const { searchQueryId } = req.body;

    logger.info(`jobs; addSearchQuery #${jobId}`);
    services.job.deleteSearchQueryFromJob(jobId, searchQueryId)
        .then((job) => res.status(200).send(job))
        .catch((reason) => res.status(reason.status).send({ message: reason.message }));
};

exports.updateStatus = (req, res) => {
    const { jobId, newStatus } = req.params;
    // todo validate new status

    // get job details first for further check
    Job.findById(jobId)
        .then((job) => {
            if (!job) {
                return res.status(404).send({ message: `Job not found with id ${req.params.jobId}` });
            }

            // if job status is done, check if the job is a recurring one or not, if so update as recurring
            const finalStatus = (newStatus === defs.job.status.COMPLETED
                && (job.frequency.indexOf('h') !== -1 || job.frequency.indexOf('m') !== -1))
                ? defs.job.status.RECURRING : newStatus;

            return Job.findByIdAndUpdate(jobId, { $set: { status: finalStatus } })
                .then((updatedJob) => res.send(updatedJob))
                .catch((err) => {
                    if (err.kind === 'ObjectId' || err.name === 'NotFound') {
                        return res.status(404).send({ message: `Job not found with id ${jobId}` });
                    }
                    return res.status(500).send({ message: `Could not job report with id ${jobId}` });
                });
        })
        .catch((err) => {
            if (err.kind === 'ObjectId') {
                return res.status(404).send({ message: `Job not found with id ${req.params.jobId}` });
            }
            return res.status(500).send({ message: `Error retrieving job with id ${req.params.jobId}` });
        });
};
