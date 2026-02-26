# Browser Node with Xvfb + VNC: 无显示器时可从浏览器通过 noVNC 看界面（如知乎登录页）
# 构建: docker build -t monou-browser-node -f apps/browser-node/Dockerfile apps/browser-node
# 运行: 见 scripts/test-browser-node-docker.sh

FROM mcr.microsoft.com/playwright:v1.50.0-noble

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99

# 已有 Playwright + 浏览器；补 Xvfb + x11vnc + noVNC
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    xauth \
    curl \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir websockify \
    && mkdir -p /usr/local/noVNC \
    && curl -sL https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz -C /usr/local/noVNC --strip-components=1 \
    && chmod +x /usr/local/noVNC/utils/novnc_proxy 2>/dev/null || true

WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# 5900: VNC 原生, 6080: noVNC HTTP
EXPOSE 5900 6080

ENTRYPOINT ["/docker-entrypoint.sh"]
