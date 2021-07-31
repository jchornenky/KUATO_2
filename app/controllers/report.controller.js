const nunjucks = require('nunjucks');
const pdf = require('html-pdf');
const moment = require('moment');

const Report = require('../models/report.model');
const Job = require('../models/job.model');
const ReportUrl = require('../models/reportUrl.model');
const logger = require('../util/logger');

const defs = require('../constants');
const services = require('../services');
const folderConfig = require('../../config/folder.config');

exports.create = (req, res) => {
    // todo tuku Validate request

    const report = new Report({
        jobId: req.body.jobId,
        status: defs.report.status.INIT,
        result: {
            errorCount: 0,
            message: null
        }
    });

    report.save()
        .then((data) => {
            res.send(data);
        })
        .catch((err) => {
            res.status(500).send({
                message: err.message || 'Some error occurred while creating the Report.'
            });
        });
};

exports.findAllByJobId = (req, res) => {
    const page = (req.query.page || 1) - 1;
    const limit = req.query.limit || 100;

    Report.find({ jobId: req.params.jobId }, null, { skip: page * 10, limit }).sort([['_id', -1]])
        .then((jobs) => {
            res.send(jobs);
        })
        .catch((err) => {
            res.status(500).send({
                message: err.message || 'Some error occurred while retrieving reports.'
            });
        });
};

exports.findOne = (req, res) => {
    Report.findById(req.params.reportId)
        .then((report) => {
            if (!report) {
                return res.status(404).send({
                    message: `Report not found with id ${req.params.reportId}`
                });
            }

            return res.send(report);
        })
        .catch((err) => {
            if (err.kind === 'ObjectId') {
                return res.status(404).send({
                    message: `Report not found with id ${req.params.reportId}`
                });
            }
            return res.status(500).send({
                message: `Error retrieving report with id ${req.params.reportId}`
            });
        });
};

exports.findAll = (req, res) => {
    const { includeJobs } = req.query;
    Report.find()
        .sort({ _id: -1 })
        .limit(100)
        .then((reports) => {
            if (!reports || reports.length === 0) {
                return res.status(404).send({ message: 'No Reports found' });
            }

            if (includeJobs === 'true') {
                const jobIds = reports.map((r) => r.jobId);
                return services.job.getJobs(jobIds)
                    .then((jobs) => {
                        const parsedJobs = {};
                        jobs.forEach((job) => {
                            parsedJobs[job.id] = job.toJSON();
                        });
                        const reportsData = reports.map((reportData) => {
                            const report = reportData.toJSON();
                            report.job = report.jobId in parsedJobs ? parsedJobs[report.jobId] : {};
                            return report;
                        });
                        return res.send(reportsData);
                    });
            }

            return res.send(reports);
        })
        .catch((err) => {
            if (err.kind === 'ObjectId') {
                return res.status(404).send({ message: 'No Reports found' });
            }
            return res.status(500).send({ message: 'No Reports found' });
        });
};

exports.exportExcel = (req, res) => {
    Report.findById(req.params.reportId)
        .then((report) => {
            if (!report) {
                return res.status(404).send({
                    message: `Report not found with id ${req.params.reportId}`
                });
            }

            try {
                const fullPath = services.excel.exportData(
                    JSON.parse(JSON.stringify(report.toJSON({ virtuals: false }))).urls, report.jobId
                );

                if (fullPath) {
                    return res.download(fullPath);
                }
            }
            catch (e) {
                logger.error('parse data to excel error', e);
                return res.status(500).send({
                    message: `Error retrieving report with id ${req.params.reportId}`
                });
            }

            return res.status(500).send({
                message: `Error retrieving report with id ${req.params.reportId}`
            });
        })
        .catch((err) => {
            if (err.kind === 'ObjectId') {
                return res.status(404).send({
                    message: `Report not found with id ${req.params.reportId}`
                });
            }
            return res.status(500).send({
                message: `Error retrieving report with id ${req.params.reportId}`
            });
        });
};

exports.exportPdf = (req, res) => {
    nunjucks.configure(folderConfig.templates, { autoescape: true });

    Report.findById(req.params.reportId)
        .then((report) => {
            if (!report) {
                return res.status(404).send({
                    message: `Report not found with id ${req.params.reportId}`
                });
            }

            try {
                const htmlData = nunjucks.render('report.template.html.njk', {
                    urls: JSON.parse(JSON.stringify(report.toJSON({ virtuals: false }))).urls,
                    reportName: report.jobId
                });

                const options = {
                    format: 'Letter',
                    orientation: "landscape"
                };
                const finalFileName = `${folderConfig.pdf}/${moment().format()}_${report.jobId}.pdf`;

                return pdf.create(htmlData, options).toFile(finalFileName, (err, response) => {
                    if (err) {
                        return res.status(500).send({
                            message: `Error retrieving report with id ${req.params.reportId}`
                        });
                    }
                    return res.download(finalFileName);
                });
            }
            catch (e) {
                logger.error('parse data to excel error', e);
                return res.status(500).send({
                    message: `Error retrieving report with id ${req.params.reportId}`
                });
            }
        })
        .catch((err) => {
            if (err.kind === 'ObjectId') {
                return res.status(404).send({
                    message: `Report not found with id ${req.params.reportId}`
                });
            }
            return res.status(500).send({
                message: `Error retrieving report with id ${req.params.reportId}`
            });
        });
};

exports.delete = (req, res) => {
    const { reportId } = req.params;
    Report.findByIdAndRemove(reportId)
        .then((report) => {
            if (!report) {
                return res.status(404).send({
                    message: `Report not found with id ${reportId}`
                });
            }

            return res.send({ message: 'Report deleted successfully!' });
        })
        .catch((err) => {
            if (err.kind === 'ObjectId' || err.name === 'NotFound') {
                return res.status(404).send({
                    message: `Report not found with id ${reportId}`
                });
            }
            return res.status(500).send({
                message: `Could not delete report with id ${reportId}`
            });
        });
};

exports.updateStatus = (req, res) => {
    const { reportId, newStatus } = req.params;
    // todo validate new status
    return Report.findByIdAndUpdate(reportId, { $set: { status: newStatus } })
        .then((report) => {
            if (!report) {
                return res.status(404).send({
                    message: `Report not found with id ${reportId}`
                });
            }

            // send notifications if completed, change job's last report
            if (newStatus === defs.report.status.DONE) {
                Job.findOne({ _id: report.jobId })
                    .then((jobData) => {
                        const job = jobData;
                        if (job.notifications && job.notifications.length > 0) {
                            try {
                                const fullPath = services.excel.exportData(
                                    JSON.parse(JSON.stringify(report.toJSON({ virtuals: false }))).urls, report.jobId
                                );

                                if (fullPath) {
                                    job.notifications.forEach((notificationSchema) => {
                                        if (notificationSchema.type === defs.job.notificationSchemaType.MAIL) {
                                            services.mail.send(
                                                notificationSchema.recipient,
                                                `report for ${job.name}`,
                                                `${report.result.errorCount} errors. ${report.result.message}`,
                                                fullPath
                                            ).then().catch();
                                        }
                                    });
                                }
                            }
                            catch (e) {
                                logger.error('parse data to excel error', e);
                            }
                        }

                        job.lastReport = {
                            status: newStatus,
                            errorCount: report.result.errorCount
                        };
                        job.save().then().catch();
                    });
            }

            return res.send(report);
        })
        .catch((err) => {
            if (err.kind === 'ObjectId' || err.name === 'NotFound') {
                return res.status(404).send({
                    message: `Report not found with id ${reportId}`
                });
            }
            return res.status(500).send({
                message: `Could not update report with id ${reportId}`
            });
        });
};

exports.addUrl = (req, res) => {
    // todo tuku Validate request

    const { reportId } = req.params;
    const reportUrl = {
        searchQueryId: req.body.searchQueryId,
        name: req.body.name,
        sourcePageUrl: req.body.sourcePageUrl,
        flagUrl: req.body.flagUrl,
        severity: req.body.severity,
        status: req.body.status,
        element: req.body.element,
        ccid: req.body.ccid,
        reason: req.body.reason,
        flag: req.body.flag
    };
    const errorCountChange = reportUrl.status === defs.report.urlStatus.ERROR ? 1 : 0;

    Report.findByIdAndUpdate(reportId, {
        $push: { urls: reportUrl },
        $inc: { 'result.errorCount': errorCountChange }
    })
        .then((report) => {
            if (!report) {
                return res.status(404).send({
                    message: `Report not found with id ${reportId}`
                });
            }

            return res.status(200).send({ message: 'Report deleted successfully!' });
        })
        .catch((err) => {
            if (err.kind === 'ObjectId' || err.name === 'NotFound') {
                return res.status(404).send({
                    message: `Report not found with id ${reportId}`
                });
            }
            return res.status(500).send({
                message: `Could not update report with id ${reportId}`
            });
        });
};
