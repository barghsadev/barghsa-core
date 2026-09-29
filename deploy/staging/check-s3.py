"""Exercise private S3 writes and a public, path-style signed download."""

import os
from uuid import uuid4
from urllib.request import urlopen

import boto3
from botocore.config import Config


credentials = {
    "aws_access_key_id": os.environ["S3_ACCESS_KEY_ID"],
    "aws_secret_access_key": os.environ["S3_SECRET_ACCESS_KEY"],
    "region_name": os.environ["S3_REGION"],
    "config": Config(signature_version="s3v4", s3={"addressing_style": "path"}),
}
private = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"], **credentials)
public = boto3.client("s3", endpoint_url=os.environ["S3_PUBLIC_ENDPOINT"], **credentials)
bucket = os.environ["S3_BUCKET"]
key = f"deployment-check/{uuid4().hex}.txt"
body = b"barghsa staging S3 check\n"

private.head_bucket(Bucket=bucket)
try:
    private.put_object(Bucket=bucket, Key=key, Body=body, ContentType="text/plain")
    signed_url = public.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=60
    )
    with urlopen(signed_url, timeout=20) as response:
        assert response.read() == body
finally:
    private.delete_object(Bucket=bucket, Key=key)

print("Private S3 write and public signed read: PASS")
