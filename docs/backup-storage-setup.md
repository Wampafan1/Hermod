# Backup Storage Setup

Hermod Niflheim stores PostgreSQL backup artifacts in tenant-owned cloud object storage. The storage wizard supports guided setup for AWS S3 and Google Cloud Storage, plus assisted provisioning when the Hermod runtime already has safe cloud credentials.

## AWS S3

### Recommended: Assume Role With ExternalId

Hosted Hermod should use an IAM role in your AWS account with an ExternalId condition. This avoids long-lived access keys and prevents confused-deputy access.

The wizard can generate:

- A CloudFormation template that creates the S3 bucket, encryption, versioning, lifecycle retention, and an IAM role.
- A dedicated-bucket IAM policy that lets Hermod write, read, list, and delete backup artifacts anywhere in that bucket.
- AWS CLI commands for bucket setup.

An AWS administrator runs the template, then pastes the stack outputs back into Hermod:

- `BucketName`
- `Region`
- `Prefix`
- `RoleArn`
- `ExternalId`

Hermod stores only the role ARN and ExternalId, encrypted at rest.

### Recommended For Self-Hosted AWS: Runtime Role

Self-hosted Hermod on EC2, ECS, EKS, or another AWS runtime can use the attached instance, task, pod, or container role. Hermod stores no credentials for this mode. The worker runtime must have the same access because backup jobs run in the worker.

### Fallback: Access Key

Access keys are supported only as a fallback. Create a dedicated IAM user or role-derived key with access limited to the selected backup bucket. Hermod encrypts the key at rest and never returns saved credentials through API reads.

Do not use AWS root credentials.

## Google Cloud Storage

### Recommended For Self-Hosted GCP: Application Default Credentials

Hermod can use Application Default Credentials from the runtime service account. This mode stores no service account key in Hermod. The web and worker runtimes both need access to the target bucket.

### Future Hosted Mode: Workload Identity Federation

The wizard shows Workload Identity Federation as the preferred hosted direction, but saving that mode is disabled until federation configuration is implemented.

### Fallback: Service Account JSON

Service account JSON is supported as a fallback. Upload it through Hermod instead of pasting private keys into shell commands or shell history. Hermod encrypts the key and never returns it from storage target reads.

## What Hermod Tests

Before a target is marked active, Hermod performs a real storage checklist:

- Bucket exists.
- Region or location matches when the provider exposes it.
- The bucket can be listed with the configured test prefix.
- A test object can be written.
- The test object can be read.
- The test object can be deleted.
- Encryption and lifecycle settings can be detected when supported.

Warnings are shown for optional metadata checks, but write, read, list, and delete failures keep the target out of active status unless an administrator explicitly saves it as an error target.

## Lifecycle Retention

The wizard can generate lifecycle rules that expire objects under the configured prefix after the selected retention window. The prefix is an organization and lifecycle setting, not the AWS IAM security boundary. For S3, Hermod assumes the bucket is dedicated to backups and the generated IAM object policy is bucket-wide so backup policies can choose their own artifact paths. Niflheim also keeps run metadata so artifact visibility remains available even after storage lifecycle removes old objects.

## Backup Restore Caveat

Logical dumps can be restored into a database with PostgreSQL tools such as `pg_restore`. WAL/PITR coverage is different: it normally requires a compatible base backup and restores into a fresh PostgreSQL data directory. Hermod surfaces WAL coverage separately so operators can see when PITR prerequisites are missing or stale.
