FROM alpine:3.21

RUN apk add --no-cache bash busybox-extras openssh-client netcat-openbsd \
    && adduser -D -h /home/operator operator \
    && mkdir -p /www \
    && printf 'ready\n' > /www/index.html \
    && chown -R operator:operator /www /home/operator

USER operator
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/
CMD ["httpd", "-f", "-p", "8080", "-h", "/www"]
