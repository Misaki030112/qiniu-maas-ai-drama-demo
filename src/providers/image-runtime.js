async function downloadImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download image failed with ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function getImageTask({ baseUrl, headers, taskId }) {
  const response = await fetch(`${baseUrl}/images/tasks/${taskId}`, {
    headers,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Image task query failed with ${response.status}`);
  }
  return payload;
}

export async function pollImageTask({ baseUrl, headers, taskId }) {
  while (true) {
    const payload = await getImageTask({ baseUrl, headers, taskId });
    const status = String(payload?.status || "").toLowerCase();
    if (["succeed", "success", "completed"].includes(status)) {
      return payload;
    }
    if (["failed", "error", "cancelled"].includes(status)) {
      throw new Error(payload?.status_message || `Image task failed: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function resolveImagePayload({ baseUrl, headers, payload }) {
  const item = payload?.data?.[0];
  if (item?.b64_json) {
    return {
      ...payload,
      buffer: Buffer.from(item.b64_json, "base64"),
    };
  }

  if (item?.url) {
    return {
      ...payload,
      buffer: await downloadImageBuffer(item.url),
    };
  }

  const taskId = payload?.task_id || payload?.id;
  if (taskId) {
    const taskResult = await pollImageTask({ baseUrl, headers, taskId });
    return resolveImagePayload({
      baseUrl,
      headers,
      payload: {
        ...taskResult,
        task_id: taskId,
      },
    });
  }

  throw new Error("Image response does not contain b64_json, url, or task_id.");
}
