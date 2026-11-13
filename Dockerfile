FROM nginx:1.27-alpine
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  add_header Cache-Control no-cache;\n}\n' > /etc/nginx/conf.d/default.conf
COPY web/dist /usr/share/nginx/html
