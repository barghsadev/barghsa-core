FROM clamav/clamav:1.5@sha256:45fe5149fbee5a46509c9848ef20d0c354b7b2323c9369f285939a37cf33422a

# The API limits document uploads to 50 MiB. ClamAV's default INSTREAM limit
# is smaller, so configure the daemon to inspect the entire uploaded object.
# Archive expansion limits stay in place and are reported as a blocked verdict.
RUN grep -q '^TCPSocket 3310$' /etc/clamav/clamd.conf \
    && printf '\nStreamMaxLength 50M\nAlertExceedsMax yes\nConcurrentDatabaseReload no\n' >> /etc/clamav/clamd.conf
COPY deploy/clamav/healthcheck.sh /usr/local/bin/barghsa-clamav-healthcheck
RUN chmod 755 /usr/local/bin/barghsa-clamav-healthcheck
