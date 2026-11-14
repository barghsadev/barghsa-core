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


def remove_probe(private, object_ref, nonce, versioned, uploaded):
    version = (uploaded or {}).get("VersionId")
    etag = (uploaded or {}).get("ETag")
    if not version or version == "null":
        # Some providers omit VersionId. A lost PUT response also needs
        # readback before any cleanup can be authorized.
        try:
            metadata = private.head_object(**object_ref)
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code")
            if uploaded is None and code in ("404", "NotFound", "NoSuchKey"):
                return
            raise
        if (metadata.get("Metadata", {}).get("barghsa-probe") != nonce
                or (etag and metadata.get("ETag") != etag)
                or (version and metadata.get("VersionId") != version)):
            raise ValueError("Storage did not confirm ownership of the probe object")
        version = metadata.get("VersionId")
        etag = metadata.get("ETag")
    if versioned and not version:
        raise ValueError("Versioned storage did not identify the probe object version")
    cleanup_ref = {**object_ref, "VersionId": version} if version else object_ref
    if not version or version == "null":
        if not etag:
            raise ValueError("Storage did not identify the mutable probe object")
        cleanup_ref = {**cleanup_ref, "IfMatch": etag}
    removed = private.delete_object(**cleanup_ref)
    if removed.get("DeleteMarker") or removed.get("VersionId", version) != version:
        raise ValueError("S3 cleanup did not confirm the intended object deletion")


def verify_storage(private, public, bucket):
    nonce = uuid4().hex
    object_ref = {"Bucket": bucket, "Key": f"deployment-check/{nonce}.txt"}
    body = f"barghsa staging S3 check {nonce}\n".encode()
    opener = build_opener(NoRedirect())

    private.head_bucket(Bucket=bucket)
    versioned = private.get_bucket_versioning(Bucket=bucket).get("Status") in ("Enabled", "Suspended")
    uploaded = None
    try:
        uploaded = private.put_object(
            **object_ref, Body=body, ContentType="text/plain",
            Metadata={"barghsa-probe": nonce}, IfNoneMatch="*",
        )
        signed_url = public.generate_presigned_url("get_object", Params=object_ref, ExpiresIn=60)
        with opener.open(signed_url, timeout=20) as response:
            if response.status != 200 or response.read(len(body) + 1) != body:
                raise ValueError("Signed S3 download did not match the probe bytes")
    finally:
        remove_probe(private, object_ref, nonce, versioned, uploaded)


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
