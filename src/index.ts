import 'dotenv/config';
import { bootstrap, JobQueueService } from '@vendure/core';
import { config } from './vendure-config';

bootstrap(config)
    .then((app) => {
        // Single-process hosting (free tier): run the job queue inside the server,
        // otherwise search indexing and category collections never get processed.
        if (process.env.RUN_WORKER_IN_SERVER !== 'false') {
            return app.get(JobQueueService).start();
        }
    })
    .catch((err) => {
        console.log(err);
    });
