# MarksUpPodCX

A static RSS generator for podcasts to be hosted on S3/CloudFront.

This software can be used with an S3 bucket with website hosting enabled, optionally fronted by a CDN
(such as CloudFront) to host a podcast. The RSS generator lambda function is setup to receive S3 update
events, so that whenever a file is changed in the S3 bucket, the generator will immediately be called to
parse the files and generate an RSS file for the podcast.

Additionally podcast episodes may be prescheduled, so that they are only published at a future date.
To facilitate future publishing, the RSS generator lambda should also be connected to an EventBridge that
issues cron events at the required interval (currently future scheduling resolution is one day).

## Installation

1. Create an S3 bucket to host the podcast, and set it to:
    - Use ACL
    - Enable website hosting
    
2. publish the Lambda layer in `src/layer` by going into that directory and running `make` (see below, in _Creating The Custom Layer_ for details).

3. Log into the AWS Lambda console and create a new Node.js x86_64 function:
   
    1. For the code content, put in the content of `src/lambda/index.js`
    2. Add a new layer and choose "Custom" and the layer you created in step (2).
    3. Add a new trigger and select:
        * Type: S3
        * Bucket: the bucket you created in step (1)
        * Event type: all object create events
    4. Add another trigger and select:
        * Type: S3
        * Bucket: the bucket you created in step (1)
        * Event type: all object delete events
    5. Add another trigger (this is optional and only needed if you want to schedule future publications):
        * Type: EventBridge
        * Rule: create a new rule
        * Rule name and description: put something descriptive that works for you
        * Rule type: schedule expression
        * Schedule expression: `cron(0 1 * * ? *)`
    6. Go to "Configuration" and then "Environment variables" and create the following variables:
        * `podcast_name`: the name of your podcast (this field is not written into the RSS and is mainly used for logging)
        * `bucket`: the name of the bucket you created in step (1)
        * `baseURL`: a URL that can be used to access the root of the bucket - either the S3 hosted website URL or the URL you assigned in a CDN to access that origin.
        * `author`: a name to be used for the RSS "author" entry
        * `owner`: a name to be used for the RSS "owner" entry
        * `owner_email`: a name to be used for the RSS "owner email" entry
        * `categories`: a list of comma separated "categories" according to the iTunes category list, to be used for the iTunes-specific RSS categories list.
    
4. Optionally (but recommended) configure Lambda to send you error notifications by email:

    1. Go to the AWS SNS console and create a new topic.
    2. Subscribe your email address to the new topic
    3. In the AWS Lambda console, in your new lambda function, click "Add Destination" and configure it:
        * Source: Asynchronous invocation
        * Condition: on failure
        * Destination type: SNS topic
        * Destination: select the topic you created

## Usage

### Create Podcast Descriptor

The first thing to do is to create the "top level" podcast descriptor - this contains information that goes into the "`channel`" section of the RSS (i.e. the podcast details, in contrast to the per-episode details).

To create the descriptor you need to create a few files and place them at the root of the S3 bucket:

- Markdown file with a description and title:
  - The first level headline (starting with a single `#`) will be used as the podcast's title.
  - If the last line starts with the text `Keywords:` the rest of the line will be understood as a comma-separated list of keywords to be copied to each episode's RSS "keywords" tag.
  - All other content will be rendered as the podcast description.
- Image files to be used as the podcast images (thumbnails). These must be in PNG format and will be listed in name order. It is recommended to name all the files identically with a suffix specifying the dimensions of the file. For example `my-podcast-150.png`.

### Create Episodes

For each episode, create a folder names according to the desired publication date of that episode - using ISO 8601 date format (i.e. `YYYY-MM-DD` format, for example `2022-08-15`).

In each episode folder, place the following files:

- An MP3 file that is the podcast content.
- A markdown file with a description, title and keywords:
  - The first level headline (starting with a single `#`) will be used as the episode's title.
  - If the last line starts with the text `Keywords:` the rest of the line will be understood as a comma-separated list of keywords to be used in the episode's RSS "keywords" tag.
  - All other content will be rendered as the episode's description.
- Image files to be used as the episodes images (thumbnails). These must be in PNG format and will be listed in name order. It is recommended to name all the files identically with a suffix specifying the dimensions of the file. For example `episode-1-150.png`.

### Generate RSS

Whenever the content of the bucket changes (and every 1AM UTC, if the EventBridge trigger was created), the generator will run to create a file named `rss` in the bucket top level directory - so that it can be loaded by accessing the `baseURL` configured for the generator with the suffix `/rss` - for example, if the base URL is set to `https://podcast.example.com` (and it is configured correctly), the RSS will be accessible using the URL `https://podcast.example.com/rss`.

The RSS can then be published to podcast platforms.

## Creating The Custom Layer

The lambda function uses a custom AWS Lambda layer to load node modules that are required.

A `Makefile` for GNU Make is provided to help build and publish the custom layer using standard tools that should be available on all platforms:
  - `make` (GNU Make is expected, but it will likely work fine on other Make implementations)
  - the `npm` command
  - the `zip` command
  - the AWS command line tool, that is already configured for your AWS account.

If you don't have GNU Makefile installed (and you don't run Linux where getting it is as easy as running `pkcon install make`), just review the file and it
should be clear what it does (it isn't one of those scare `Makefile`s).

### Using the Makefile

If you just run `make` in the `src/layer` folder - as recommended in the installation instructions above - you'd get the new layer built and installed using
the AWS CLI default settings - i.e. the AWS default profile (named "`default`") and the AWS region `us-east-1`. These settings can be overridden using the
environment variables (or Make arguments) `AWS_PROFILE` and `AWS_REGION`.

For example:

```
make AWS_PROFILE=myprofile AWS_REGION=eu-west-2
```

### Troubleshooting

If the RSS generator fails, check the Lambda cloudwatch logs for error messages.

The most common issues are:

 * Make sure the memory limit is high enough. Work has been done to serialize the loading of the media files (which we need to do in order to check for media
   duration), so that we never need more memory than what is required to load one file, but if your files are very big - you may actually run out of the default
   128MB RAM allowed for the Lambda function. If you get memory limit issues - try to go into your Lambda function "Configuration" page and increase the limit.
 * Make sure the time limit is high enough. Because we load S3 objects, some very big and in a serial way (see the point above), the RSS generator may take more
   time than the default 10 seconds limit. If you get timeout errors - try to go into your Lambda function "Configuration" page and increase the time limit.
   We found that the 10 seconds limit is insufficient almost immediately, and we recommend setting a 60 seconds timeout to start with.
