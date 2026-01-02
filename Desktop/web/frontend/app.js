(() => {
  const DEFAULT_API_BASE = "http://localhost:8000";
  const API_BASE = DEFAULT_API_BASE;

  const dom = {
    videoInput: document.getElementById("videoInput"),
    fileLabel: document.getElementById("fileLabel"),
    uploadBtn: document.getElementById("uploadBtn"),
    uploadProgress: document.getElementById("uploadProgress"),
    uploadStatus: document.getElementById("uploadStatus"),
    backendStatus: document.getElementById("backendStatus"),
    videoMeta: document.getElementById("videoMeta"),
    frameCountLabel: document.getElementById("frameCountLabel"),
    frameList: document.getElementById("frameList"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    currentFrameLabel: document.getElementById("currentFrameLabel"),
    previewImage: document.getElementById("previewImage"),
    previewPlaceholder: document.getElementById("previewPlaceholder"),
  };

  const state = {
    videoId: null,
    frameCount: 0,
    fps: 0,
    page: 0,
    pageSize: 60,
    frames: [],
    selectedIndex: -1,
    loading: false,
  };

  function init() {
    bindEvents();
    updateBackendStatus("Waiting for backend");
    updateUploadStatus("Waiting for upload.");
    updateFrameControls();
    dom.loadMoreBtn.style.display = "none";
  }

  function bindEvents() {
    dom.videoInput.addEventListener("change", handleFileSelection);
    dom.uploadBtn.addEventListener("click", handleUploadClick);
    dom.loadMoreBtn.addEventListener("click", () => loadFrames(state.page + 1));
    dom.frameList.addEventListener("click", handleFrameClick);
    dom.prevBtn.addEventListener("click", () => selectFrame(state.selectedIndex - 1));
    dom.nextBtn.addEventListener("click", () => selectFrame(state.selectedIndex + 1));
    dom.frameList.addEventListener("scroll", handleFrameListScroll);
    document.addEventListener("keydown", handleKeyNavigation);
  }

  function handleFileSelection(event) {
    const file = event.target.files[0];
    if (!file) {
      dom.fileLabel.textContent = "Choose video file";
      return;
    }
    dom.fileLabel.textContent = file.name;
  }

  function handleUploadClick() {
    const file = dom.videoInput.files[0];
    if (!file) {
      updateUploadStatus("Select a video file first.");
      return;
    }
    uploadVideo(file);
  }

  function updateBackendStatus(text) {
    dom.backendStatus.textContent = text;
  }

  function updateUploadStatus(text) {
    dom.uploadStatus.textContent = text;
  }

  function resetFrames() {
    state.frames = [];
    state.page = 0;
    state.selectedIndex = -1;
    dom.frameList.innerHTML = "<div class='empty-state'>Loading frames...</div>";
    dom.previewImage.style.display = "none";
    dom.previewImage.src = "";
    dom.previewPlaceholder.style.display = "block";
    dom.loadMoreBtn.style.display = "none";
    updateFrameControls();
  }

  function uploadVideo(file) {
    updateBackendStatus("Uploading...");
    updateUploadStatus("Uploading and extracting frames...");
    dom.uploadProgress.value = 0;
    dom.uploadBtn.disabled = true;

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/videos`);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        dom.uploadProgress.value = percent;
        updateUploadStatus(`Uploading... ${percent}%`);
      }
    });

    xhr.addEventListener("load", () => {
      dom.uploadBtn.disabled = false;
      if (xhr.status >= 200 && xhr.status < 300) {
        const payload = JSON.parse(xhr.responseText);
        state.videoId = payload.video_id;
        state.frameCount = payload.frame_count;
        state.fps = payload.fps;
        updateBackendStatus("Extraction complete");
        updateUploadStatus(payload.message || "Upload complete.");
        dom.videoMeta.textContent = `Video ID: ${payload.video_id} | Frames: ${payload.frame_count} | FPS: ${payload.fps}`;
        dom.frameCountLabel.textContent = `${payload.frame_count} frames`;
        resetFrames();
        loadFrames(1);
      } else {
        handleError(`Upload failed: ${xhr.responseText || xhr.statusText}`);
      }
    });

    xhr.addEventListener("error", () => {
      dom.uploadBtn.disabled = false;
      handleError("Upload failed: network error.");
    });

    xhr.send(formData);
  }

  async function loadFrames(page) {
    if (!state.videoId || state.loading) {
      return;
    }
    if (state.frameCount && state.frames.length >= state.frameCount) {
      return;
    }

    state.loading = true;
    dom.loadMoreBtn.disabled = true;
    updateUploadStatus(`Loading frames (page ${page})...`);

    try {
      const response = await fetch(
        `${API_BASE}/api/videos/${state.videoId}/frames?page=${page}&page_size=${state.pageSize}`
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json();
      state.page = data.page;
      state.frameCount = data.total_frames;
      dom.frameCountLabel.textContent = `${data.total_frames} frames`;
      appendFrames(data.frames || []);
      updateUploadStatus("Frames ready.");
    } catch (error) {
      handleError(`Frame load failed: ${error.message}`);
    } finally {
      state.loading = false;
      dom.loadMoreBtn.disabled = false;
      updateLoadMoreState();
    }
  }

  function appendFrames(frames) {
    if (!frames.length && !state.frames.length) {
      dom.frameList.innerHTML = "<div class='empty-state'>No frames extracted.</div>";
      return;
    }

    if (!state.frames.length) {
      dom.frameList.innerHTML = "";
    }

    const fragment = document.createDocumentFragment();
    frames.forEach((frame) => {
      const listIndex = state.frames.length;
      state.frames.push(frame);
      fragment.appendChild(createFrameItem(frame, listIndex));
    });
    dom.frameList.appendChild(fragment);

    if (state.selectedIndex === -1 && state.frames.length > 0) {
      selectFrame(0);
    }
  }

  function createFrameItem(frame, listIndex) {
    const item = document.createElement("div");
    item.className = "frame-item";
    item.dataset.index = String(listIndex);

    const thumb = document.createElement("img");
    thumb.className = "frame-thumb";
    thumb.loading = "lazy";
    thumb.src = buildFrameUrl(frame.url);
    thumb.alt = `Frame ${frame.index}`;

    const info = document.createElement("div");
    info.className = "frame-info";

    const index = document.createElement("div");
    index.className = "frame-index";
    index.textContent = `Frame ${padIndex(frame.index)}`;

    const url = document.createElement("div");
    url.className = "frame-url";
    url.textContent = frame.url;

    info.appendChild(index);
    info.appendChild(url);

    item.appendChild(thumb);
    item.appendChild(info);
    return item;
  }

  function handleFrameClick(event) {
    const item = event.target.closest(".frame-item");
    if (!item) {
      return;
    }
    const index = Number(item.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    selectFrame(index);
  }

  function selectFrame(index) {
    if (index < 0) {
      return;
    }

    if (index >= state.frames.length) {
      if (state.frames.length < state.frameCount && !state.loading) {
        loadFrames(state.page + 1).then(() => selectFrame(index));
      }
      return;
    }

    state.selectedIndex = index;
    const frame = state.frames[index];
    const url = buildFrameUrl(frame.url);

    dom.previewImage.src = url;
    dom.previewImage.style.display = "block";
    dom.previewPlaceholder.style.display = "none";

    dom.currentFrameLabel.textContent = `Frame ${frame.index} / ${state.frameCount}`;

    Array.from(dom.frameList.querySelectorAll(".frame-item")).forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.index) === index);
    });

    updateFrameControls();
  }

  function updateFrameControls() {
    const hasSelection = state.selectedIndex >= 0;
    const totalKnown = state.frameCount || state.frames.length;
    const lastIndex = Math.max(0, totalKnown - 1);
    dom.prevBtn.disabled = !hasSelection || state.selectedIndex === 0;
    dom.nextBtn.disabled = !hasSelection || state.selectedIndex >= lastIndex;
  }

  function updateLoadMoreState() {
    const remaining = state.frames.length < state.frameCount;
    dom.loadMoreBtn.style.display = remaining ? "block" : "none";
  }

  function handleFrameListScroll() {
    const list = dom.frameList;
    if (!list || state.loading) {
      return;
    }
    const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
    if (nearBottom && state.frames.length < state.frameCount) {
      loadFrames(state.page + 1);
    }
  }

  function handleKeyNavigation(event) {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      return;
    }
    if (event.key === "ArrowLeft") {
      selectFrame(state.selectedIndex - 1);
    }
    if (event.key === "ArrowRight") {
      selectFrame(state.selectedIndex + 1);
    }
  }

  function padIndex(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return String(value);
    }
    return String(number).padStart(6, "0");
  }

  function buildFrameUrl(url) {
    try {
      return new URL(url, API_BASE).toString();
    } catch {
      return url;
    }
  }

  function handleError(message) {
    updateBackendStatus("Error");
    updateUploadStatus(message);
  }

  init();
})();
