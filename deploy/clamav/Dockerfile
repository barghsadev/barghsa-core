FROM clamav/clamav-debian:1.5

# The API limits document uploads to 50 MiB. ClamAV's default INSTREAM limit
# is smaller, so configure the daemon to inspect the entire uploaded object.
# Archive expansion limits stay in place and are reported as a blocked verdict.
RUN grep -q '^TCPSocket 3310$' /etc/clamav/clamd.conf \
    && printf '\nStreamMaxLength 50M\nAlertExceedsMax yes\nConcurrentDatabaseReload no\n' >> /etc/clamav/clamd.conf
COPY deploy/clamav/healthcheck.sh /usr/local/bin/barghsa-clamav-healthcheck
RUN chmod 755 /usr/local/bin/barghsa-clamav-healthcheck
