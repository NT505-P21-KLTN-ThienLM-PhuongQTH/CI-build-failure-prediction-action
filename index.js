const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

(async () => {
    try {
        const apiToken = core.getInput('api-token');
        const stopOnFailure = core.getInput('stop-on-failure') === 'true';

        const ghtorrentApiUrl = 'https://ghtorrent-api.th1enlm02.live';
        const appApiUrl = 'https://app-api.th1enlm02.live';
        const predictApiUrl = 'https://golden-lacewing-famous.ngrok-free.app/predict';

        core.info(`[INFO] Starting execution with stop-on-failure: ${stopOnFailure}, API token: ${apiToken ? 'Provided' : 'Not provided'}`);

        // Lấy thông tin repository từ context
        const context = github.context;
        const projectName = context.payload.repository?.full_name;
        const branch = context.ref.replace('refs/heads/', '');

        if (!projectName) {
            core.setOutput('prediction', 'unknown');
            core.setOutput('probability', '0');
            throw new Error('Could not retrieve repository name from GitHub context');
        }
        core.info(`[INFO] Repository: ${projectName}, Branch: ${branch}`);

        // Gọi API GHTorrent để lấy ci_builds
        const ciBuildsUrl = `${ghtorrentApiUrl}/ci_builds?project_name=${projectName}&branch=${branch}`;
        core.info(`[INFO] Calling GHTorrent API: ${ciBuildsUrl}`);
        const ciBuildsResponse = await axios.get(ciBuildsUrl, {
            headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        });
        const ciBuilds = ciBuildsResponse.data.ci_builds;
        core.debug(`[DEBUG] GHTorrent Response: ${JSON.stringify(ciBuilds, null, 2)}`);
        if (!ciBuilds || ciBuilds.length === 0) {
            core.setOutput('prediction', 'unknown');
            core.setOutput('probability', '0');
            throw new Error('No ci_builds data retrieved from GHTorrent API');
        }

        // Gọi API App để lấy thông tin model hiện tại
        const modelUrl = `${appApiUrl}/api/ml_model/current`;
        core.info(`[INFO] Calling Model API: ${modelUrl}`);
        const modelResponse = await axios.get(modelUrl, {
            headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        });
        const { name: predictName, latest_versions } = modelResponse.data;
        const predictVersion = latest_versions[0].version;
        core.debug(`[DEBUG] Model Response: ${JSON.stringify({ predictName, predictVersion }, null, 2)}`);

        // Gọi API Predict để dự đoán
        core.info(`[INFO] Calling Predict API: ${predictApiUrl}`);
        const predictResponse = await axios.post(
            predictApiUrl,
            {
                predict_name: predictName,
                predict_version: predictVersion,
                ci_builds: ciBuilds,
            },
            {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
            }
        );
        const {
            build_failed: predicted_result,
            probability,
            threshold,
            timestamp,
            execution_time,
        } = predictResponse.data;
        core.debug(`[DEBUG] Predict Response: ${JSON.stringify(predictResponse.data, null, 2)}`);

        // Lấy github_run_id
        const githubRunId = github.context.runId;
        if (!githubRunId) {
            core.setOutput('prediction', predicted_result.toString());
            core.setOutput('probability', probability || '0');
            throw new Error('Could not retrieve github_run_id from GitHub context');
        }

        // Gọi API App để cập nhật kết quả dự đoán
        const updateUrl = `${appApiUrl}/api/prediction`;
        core.info(`[INFO] Updating prediction result at: ${updateUrl}`);
        await axios.post(
            updateUrl,
            {
                model_name: predictName,
                model_version: predictVersion,
                predicted_result,
                probability,
                threshold,
                timestamp,
                execution_time,
                github_run_id: githubRunId,
                project_name: projectName,
                branch,
            },
            {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
            }
        );

        // Đưa kết quả ra output
        core.setOutput('prediction', predicted_result.toString());
        core.setOutput('probability', probability || '0');
        if (predicted_result == 1) {
            core.info(`[INFO] Prediction Result - The prediction for the next build is: FAILURE (Probability: ${probability || '0'})`);
        } else {
            core.info(`[INFO] Prediction Result - The prediction for the next build is: SUCCESS (Probability: ${probability || '0'})`);
        }

        // Xử lý dựa trên stop-on-failure
        if (stopOnFailure && predicted_result == 1) {
            core.setFailed(`[ERROR] Build error predicted with probability ${probability || '0'} (stop-on-failure enabled)`);
        } else {
            core.info(`[INFO] Proceeding with execution (stop-on-failure: ${stopOnFailure})`);
        }
    } catch (error) {
        core.setOutput('prediction', 'unknown'); // Đặt output mặc định khi có lỗi
        core.setOutput('probability', '0');
        core.setFailed(`[ERROR] Action failed: ${error.message}`);
    }
})();