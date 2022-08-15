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
    
2. publish the Lambda layer in `src/layer` by going into that directory and running `make`.

2. Log into the AWS Lambda console and create a new Node.js x86_64 function:
   
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

* Markdown file with a description and title:
  * The first level headline (starting with a single `#`) will be used as the podcast's title. All other content will be rendered as the podcast description.
* Image files to be used as the podcast images (thumbnails). These must be in PNG format and will be listed in name order. It is recommended to name all the files identically with a suffix specifying the dimensions of the file. For example `my-podcast-150.png`.

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

