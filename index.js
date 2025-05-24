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
    const projectName = context.payload.repository?.full_name;
    const branch = context.ref.replace('refs/heads/', '');

    // Kiểm tra nếu projectName không tồn tại
    if (!projectName) {
      throw new Error('Could not retrieve repository name from GitHub context');
    }

    // Gọi API GHTorrent để lấy ci_builds
    const ciBuildsUrl = `${ghtorrentApiUrl}/ci_builds?project_name=${projectName}&branch=${branch}`;
    core.info(`Calling GHTorrent API: ${ciBuildsUrl}`);
    const ciBuildsResponse = await axios.get(ciBuildsUrl, {
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
    });
    const ciBuilds = ciBuildsResponse.data.ci_builds;

    if (!ciBuilds || ciBuilds.length === 0) {
      throw new Error('No ci_builds data retrieved from GHTorrent API');
    }

    // Gọi API App để lấy thông tin model hiện tại
    const modelUrl = `${appApiUrl}/ml_model/current`;
    core.info(`Calling Model API: ${modelUrl}`);
    const modelResponse = await axios.get(modelUrl, {
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
    });
    const { name: predictName, latest_versions } = modelResponse.data;
    const predictVersion = latest_versions[0].version;

    // Gọi API Predict để dự đoán
    core.info(`Calling Predict API: ${predictApiUrl}`);
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

    // Lấy github_run_id
    const githubRunId = github.context.runId;
    if (!githubRunId) {
      throw new Error('Could not retrieve github_run_id from GitHub context');
    }

    // Gọi API App để cập nhật kết quả dự đoán
    const updateUrl = `${appApiUrl}/api/prediction`;
    core.info(`Updating prediction result at: ${updateUrl}`);
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
      },
      {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
      }
    );

    // Đưa kết quả ra output (chuyển boolean thành chuỗi để output dễ đọc)
    core.setOutput('prediction', predicted_result.toString());
    core.setOutput('probability', probability);

    // Nếu dự đoán có lỗi, fail action
    if (predicted_result === true) {
      core.setFailed(`Build error predicted with probability ${probability}`);
    } else {
      core.info(`Build predicted as successful with probability ${probability}`);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
})();