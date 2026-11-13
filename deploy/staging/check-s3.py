"""Exercise private S3 writes and a public, path-style signed download."""

import os
import sys
from uuid import uuid4
from urllib.request import HTTPRedirectHandler, build_opener

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_storage(private, public, bucket):
    key = f"deployment-check/{uuid4().hex}.txt"
    object_ref = {"Bucket": bucket, "Key": key}
    body = b"barghsa staging S3 check\n"
    opener = build_opener(NoRedirect())

    private.head_bucket(Bucket=bucket)
    versioned = private.get_bucket_versioning(Bucket=bucket).get("Status") in ("Enabled", "Suspended")
    uploaded = private.put_object(**object_ref, Body=body, ContentType="text/plain")
    version = uploaded.get("VersionId")
    if versioned and not version:
        # Some compatible stores omit VersionId from PUT. Only recover the
        # current version when its ETag matches this exact successful write.
        metadata = private.head_object(**object_ref)
        version = metadata.get("VersionId")
        if not version or not uploaded.get("ETag") or metadata.get("ETag") != uploaded["ETag"]:
            raise ValueError("Versioned storage did not identify the probe object version")
    cleanup_ref = {**object_ref, "VersionId": version} if version else object_ref
    try:
        signed_url = public.generate_presigned_url("get_object", Params=object_ref, ExpiresIn=60)
        with opener.open(signed_url, timeout=20) as response:
            if response.status != 200 or response.read(len(body) + 1) != body:
                raise ValueError("Signed S3 download did not match the probe bytes")
    finally:
        removed = private.delete_object(**cleanup_ref)
        if removed.get("DeleteMarker") or (version and removed.get("VersionId", version) != version):
            raise ValueError("S3 cleanup did not confirm the intended object deletion")


def main():
    credentials = {
        "aws_access_key_id": os.environ["S3_ACCESS_KEY_ID"],
        "aws_secret_access_key": os.environ["S3_SECRET_ACCESS_KEY"],
        "region_name": os.environ["S3_REGION"],
        "config": Config(signature_version="s3v4", s3={"addressing_style": "path"},
                         connect_timeout=5, read_timeout=10,
                         # A retried PUT could create an extra version if its
                         # first response was lost after storage accepted it.
                         retries={"mode": "standard", "total_max_attempts": 1}),
    }
    private = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"], **credentials)
    public = boto3.client("s3", endpoint_url=os.environ["S3_PUBLIC_ENDPOINT"], **credentials)
    try:
        verify_storage(private, public, os.environ["S3_BUCKET"])
    except (BotoCoreError, ClientError, OSError, ValueError):
        print("Staging S3 probe failed during upload, signed read or cleanup", file=sys.stderr)
        return 1
    print("Private S3 write, public signed read and cleanup: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
