const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

(async () => {
    try {
        const apiToken = core.getInput('api-token');

        // Hardcode các URL API
        const ghtorrentApiUrl = 'https://d45f-58-187-118-78.ngrok-free.app';
        const appApiUrl = 'https://d0d0-58-187-118-78.ngrok-free.app';
        const predictApiUrl = 'https://golden-lacewing-famous.ngrok-free.app/predict';

        // Lấy thông tin repository từ context
        const context = github.context;
        const projectName = context.payload.repository?.full_name; // Ví dụ: NT548-P11-DevOps-Technology/class-management-student-service
        const branch = context.ref.replace('refs/heads/', ''); // Lấy branch (ví dụ: main)

        // Kiểm tra nếu projectName không tồn tại
        if (!projectName) {
        throw new Error('Could not retrieve repository name from GitHub context');
        }

        // Gọi API GHTorrent để lấy ci_builds (không mã hóa projectName để giữ ký tự /)
        const ciBuildsUrl = `${ghtorrentApiUrl}/ci_builds?project_name=${projectName}&branch=${branch}`;
        core.info(`Calling GHTorrent API: ${ciBuildsUrl}`);
        const ciBuildsResponse = await axios.get(ciBuildsUrl, {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        });
        const ciBuilds = ciBuildsResponse.data.ci_builds;

        if (!ciBuilds || ciBuilds.length === 0) {
        throw new Error('No ci_builds data retrieved from GHTorrent API');
        }

        // Gọi API Predict để dự đoán
        core.info(`Calling Predict API: ${predictApiUrl}`);
        const predictResponse = await axios.post(
        predictApiUrl,
        {
            ci_builds: ciBuilds,
        },
        {
            headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        }
        );
        const {
        model_name,
        model_version,
        predicted_result,
        probability,
        threshold,
        timestamp,
        execution_time,
        } = predictResponse.data;

        // Lấy github_run_id
        const githubRunId = github.context.run_id;

        // Gọi API App để cập nhật kết quả dự đoán
        const updateUrl = `${appApiUrl}/api/prediction`;
        core.info(`Updating prediction result at: ${updateUrl}`);
        await axios.post(
        updateUrl,
        {
            model_name,
            model_version,
            predicted_result,
            probability,
            threshold,
            timestamp,
            execution_time,
            github_run_id: githubRunId,
        },
        {
            headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        }
        );

        // Đưa kết quả ra output
        core.setOutput('prediction', predicted_result);
        core.setOutput('probability', probability);

        // Nếu dự đoán có lỗi, fail action
        if (predicted_result.toLowerCase() === 'error') {
        core.setFailed(`Build error predicted with probability ${probability}`);
        } else {
        core.info(`Build predicted as ${predicted_result} with probability ${probability}`);
        }
    } catch (error) {
        core.setFailed(`Action failed: ${error.message}`);
    }
})();