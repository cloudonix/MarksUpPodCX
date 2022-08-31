const GeneratorVersion = '1.0';
const GeneratorName = `MarksUpPodCX/${GeneratorVersion}`;
const podcast_name = process.env.podcast_name;
console.log('Starting',GeneratorName,'RSS generator for', podcast_name);

const aws = require('aws-sdk');
const s3 = new aws.S3({ apiVersion: '2006-03-01' });
const { v5: uuidv5 } = require('uuid');
const mediaDuration = require('get-mp3-duration');

const baseURL = process.env.baseURL || '';
const author = process.env.author || '';
const owner = process.env.owner || '';
const owner_email = process.env.owner_email || '';
const categories = (process.env.categories || '').split(/\s*,\s*/);
const feed_filename = process.env.filename || 'rss';

Date.prototype.toRFC822 = function() { return this.toUTCString().replace('GMT', '+0000'); };

async function listBucket(bucket, nextToken) {
    let params = { Bucket: bucket };
    if (nextToken)
        params.ContinuationToken = nextToken;
    let res = await s3.listObjectsV2(params).promise();
    let files = res.Contents.map(obj => obj.Key);
    if (!res.IsTruncated)
        return files;
    let remainder = await listBucket(bucket, res.NextContinuationToken);
    return files.concat(remainder);
}

async function storeRSS(text, bucket, key) {
	return s3.putObject({
		Bucket: bucket,
		Key: key,
		Body: text,
		ContentType: "application/xml",
		ACL: "public-read"
	}).promise();
}

async function verifyPublicRead(bucket, key) {
	let acl = await s3.getObjectAcl({ Bucket: bucket, Key: key}).promise();
	let hasPublicRead = false;
	acl.Grants.forEach(g => {
		if (g.Permission == 'READ') {
			hasPublicRead = true;
		}
	});
	if (hasPublicRead) {
        console.log('ACL for', key, 'is fine');
		return;
    }
	console.log('Need to allow public-read on', key);
	return s3.putObjectAcl({ Bucket: bucket, Key: key, ACL: 'public-read' }).promise();
}

class PodItem {
    bucket = '';
    keyPrefix = '';
    title = '';
    description = '';
    images = {};
    media = '';
	pubdate = new Date(0);
	keywords = [];
	
	publishDate() {
		return this.pubdate;
	}

	async loadDescriptor(path) {
		let s3obj = await s3.getObject({ Bucket: this.bucket, Key: this.keyPrefix + path }).promise();
		console.log('Loaded descriptor object', path, s3obj);
		this.pubdate = new Date(s3obj.LastModified);
		return s3obj.Body.toString().replace(/\r/g, '').trim();
	}
	
    async loadMarkdown(path) {
        let text = await this.loadDescriptor(path);
        let title, rest;
        [title, ...rest] = text.split("\n");
        if (title.startsWith('#')) {
            this.title = title.replace(/#\s+/,'');
        } else {
            this.title = title;
        }
        while (rest[rest.length-1].trim() == '')
			rest.pop();
		if (rest[rest.length-1].toLowerCase().startsWith("keywords:"))
			this.keywords = rest.pop().replace(/^keywords:/i,'').trim().split(/\s*,\s*/);
        this.description = rest.join("\n").trim();
        console.log("Done loading descriptor from", path);
    }
    
    async addFile(path) {
        if (path.endsWith('.md'))
            return this.loadMarkdown(path);
        else if (path.endsWith('.png'))
            this.addImage(path);
        else if (path.endsWith('.mp3'))
            this.media = path;
        else if (path == 'favicon.ico' || path == feed_filename) {} // ignore expected files that are not to be processed
        else {
            console.log('Unrecognized extension when loading item file', path);
			return;
		}
		// make sure that published media and images are accessible
		return verifyPublicRead(this.bucket, this.keyPrefix + path);
    }
    
    addImage(path) {
		let name,size,ext;
		[name,size,ext] = path.split(/(?:-(?=\d+)|(?<=\d+)\.)/);
		if (!size || !size.match(/^\d+$/)) {
			console.log('Error parsing image file', path, '! Ignoring.');
			return;
		}
		this.images[size] = path;
	}
}

class Episode extends PodItem {
    id = '';
	mediaSize = 0;
	duration = 0;
	canPublish = new Date(0);
	readingMetadata = false;
	
    constructor(bucket, id) {
        super();
        this.bucket = bucket;
        this.id = this.title = id;
        this.keyPrefix = `${id}/`;
		this.canPublish = new Date(id);
        if (isNaN(this.canPublish.getTime())) // is trailer
            this.canPublish = new Date(0);
	}
	
    publishDate() {
		return this.canPublish; // maybe the latest of this or this.pubdate? Eric said no.
	}
	
	addKeywords(keywords) {
		if (!keywords || !keywords.length)
			return;
		this.keywords = keywords.concat(this.keywords);
	}
    
    async addFile(path) {
    	console.log("Adding episode", this.id, "file", path);
		await super.addFile(path);
        console.log('Done adding episode file', path);
	}

	async updateMetadata() {
		if (!this.media || this.readingMetadata) // no need to update media metadata
			return;
		this.readingMetadata = true;
		console.log('Loading media', this.media);
		let s3obj = await s3.getObject({ Bucket: this.bucket, Key: this.keyPrefix + this.media }).promise();
		console.log('Loaded media object', this.media, s3obj);
		this.mediaSize = s3obj.ContentLength;
		this.duration = parseInt(mediaDuration(s3obj.Body)/1000, 10);
    	console.log("Media duration for", this.media, 'is', this.duration, 's');
	}

	get ready() {
		return this.media && this.title && this.duration &&
				((new Date()).getTime() > this.canPublish.getTime());
	}

	toRSS(baseurl) {
		if (!this.ready)
			return '';
		let url = baseurl + '/' + this.keyPrefix;
		let uuid = uuidv5(url, uuidv5.URL);
		return `
	<item>
		<title>${this.title}</title>
		<description><![CDATA[${this.description}]]></description>
		<link>${baseurl}/${this.id}</link>
		<guid isPermaLink="false">${uuid}</guid>
		<pubDate>${this.publishDate().toRFC822()}</pubDate>
		<itunes:subtitle>${this.title}</itunes:subtitle>
		<itunes:summary><![CDATA[${this.description}]]></itunes:summary>
		<itunes:author>${author}</itunes:author>
		<author>${owner_email} (${author})</author>
		<itunes:explicit>no</itunes:explicit>
		<itunes:keywords>${this.keywords}</itunes:keywords>
		<enclosure url="${url}${this.media}" type="audio/mpeg" length="${this.mediaSize}"/>
		<itunes:duration>${this.duration}</itunes:duration>` +

		/*
		 *	<podcast:person group="cast" role="host" img="https://feeds.podcastindex.org/adam_avatar.jpg" href="http://curry.com">Adam Curry</podcast:person>
		 *	<podcast:person href="http://dave.sobr.org" img="https://feeds.podcastindex.org/dave_avatar.jpg" group="cast" role="host">Dave Jones</podcast:person>
		 *	<podcast:socialInteract protocol="activitypub" uri="https://thread.land/podcast/7GoP6LC/95" accountId="@dave" accountUrl="https://podcastindex.social/users/dave"/>
		 */
		`${this.rssImages(url)}
	</item>`;
	}

	rssImages(url) {
		if (Object.keys(this.images).length < 1)
			return '';
		let largestImageSize = Object.keys(this.images).sort((a,b) => b-a)[0];
		let largestImage = `${url}${encodeURIComponent(this.images[largestImageSize])}`;
		let imagesrcset = Object.keys(this.images).map(size => `${url}${encodeURIComponent(this.images[size])} ${size}w`).join(", ");
		return `
		<itunes:image href="${largestImage}"/>
		<podcast:images srcset="${imagesrcset}"/>`;
	}
}

class Podcast extends PodItem {
    episodes = [];
    trailer = null;
	
	publishDate() {
		let targetDate = this.pubdate;
		for (let e of this.episodes) {
			if (targetDate.getTime() < e.publishDate().getTime() && e.ready)
				targetDate = e.publishDate();
		}
		return targetDate;
	}
	
    async loadFromBucket(bucket) {
        this.bucket = bucket;
        let files = await listBucket(bucket);
        let results = [];
        console.log("Processing files", files);
        for (let file of files) {
            let prefix, path;
            [prefix, ...path] = file.split('/');
            if (path.length) {
                if (path[0].length) // otherwise is just the episode directory node, which is just an S3 console artifact and shouldn't exist
                    results.push(this.addEpisodeFile(prefix, path.join('/')));
            } else
                results.push(this.addFile(prefix));
            console.log('Done with', file);
        }
        await Promise.all(results);
		for (let e of this.episodes)
			await e.updateMetadata();
		if (this.trailer)
			await this.trailer.updateMetadata();
        console.log("Finished processing all files");
    }
    
    async loadMarkdown(path) {
		await super.loadMarkdown(path);
		if (this.keywords.length == 0) {
            console.log("No podcast keywords");
			return;
        }
		for (let e of this.episodes)
			e.addKeywords(this.keywords);
        console.log("Finished adding podcast keywords");
	}
    
    async addEpisodeFile(id, path) {
        for (let ep of this.episodes) {
            if (ep.id == id)
                return ep.addFile(path);
        }
        if (id == 'trailer') {
            if (!this.trailer)
                this.trailer = this.createEpisode('trailer');
            return this.trailer.addFile(path);
        } else {
            let ep = this.createEpisode(id);
            this.episodes.push(ep);
            return ep.addFile(path);
        }
    }

    createEpisode(id) {
        let ep = new Episode(this.bucket, id);
		ep.addKeywords(this.keywords);
        console.log("Created new", ep);
        return ep;
    }
    
    toRSS(baseurl) {
		let url = baseurl + '/';
		let uuid = uuidv5(url, uuidv5.URL);
		let largestImageSize = Object.keys(this.images).sort((a,b) => b-a)[0];
		let largestImage = `${url}${encodeURIComponent(this.images[largestImageSize])}`;
		let imagesrcset = Object.keys(this.images).map(size => `${url}${encodeURIComponent(this.images[size])} ${size}w`).join(", ");
		return (`
<rss
		xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
		xmlns:atom="http://www.w3.org/2005/Atom"
		xmlns:podcast="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md"
		version="2.0">
	<channel>
	<title>${this.title}</title>
	<description><![CDATA[${this.description}]]></description>
	<link>${url}${feed_filename}</link>
	<atom:link rel="self" href="${url}${feed_filename}" type="application/rss+xml"/>
	<language>en</language>
	<generator>${GeneratorName}</generator>
	<pubDate>${this.publishDate().toRFC822()}</pubDate>
	<lastBuildDate>${new Date().toRFC822()}</lastBuildDate>
	<podcast:locked owner="${owner_email}">yes</podcast:locked>
	<managingEditor>${owner_email} (${owner})</managingEditor>
	<itunes:owner>
		<itunes:email>${owner_email}</itunes:email>
		<itunes:name>${owner}</itunes:name>
	</itunes:owner>
	<image>
		<url>${largestImage}</url>
		<link>${url}${feed_filename}</link>
		<title>${this.title}</title>
		<description><![CDATA[${this.description}]]></description>
		<width>${largestImageSize}</width>
		<height>${largestImageSize}</height>
	</image>
	<itunes:summary><![CDATA[${this.description}]]></itunes:summary>
	<itunes:author>${author}</itunes:author>
	<itunes:image href="${largestImage}"/>
	<itunes:explicit>no</itunes:explicit>
	<itunes:keywords>${this.keywords}</itunes:keywords>
	` + categories.map(cat => `<itunes:category text="${cat}"/>`).join("") + `
	<podcast:guid>${uuid}</podcast:guid>
	<podcast:medium>podcast</podcast:medium>
	<podcast:images srcset="${imagesrcset}"/>
		${this.episodesToRSS(baseurl)}
	</channel>
</rss>
		`).trim();
	}

	episodesToRSS(baseurl) {
		let rss = '';
		if (this.trailer) {
			if (this.trailer.canPublish.getTime() == 0) // if the trailer does not have a publish date set (which is fine)
				this.trailer.canPublish = this.episodes.length < 1 ? new Date() : // set its date to either now (if there are no episodes yet)
					new Date(this.episodes.map(e => e.canPublish.getTime()).sort((a,b) => a - b)[0] - (86400000 * 3)); // or 3 days before easrliest episode
			rss += this.trailer.toRSS(baseurl) + "\n";
		}
		rss += this.episodes.map(e => e.toRSS(baseurl)).join("\n");
		return rss;
	}

    static async load(bucket) {
        let p = new Podcast();
        await p.loadFromBucket(bucket);
        return p;
    }
}

exports.handler = async (event, context) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

	let bucket = '';
	if (event.source == "aws.events") { // scheduled refresh and not an S3 update
		bucket = process.env.bucket; // try to read bucket from the configuration
	} else {
    	// Get the object from the event and show its content type
    	bucket = event.Records[0].s3.bucket.name;
    	let key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
    	if (key.endsWith(feed_filename)) {
        	console.log("Ignoring changes to RSS feed itself...");
        	return "OK";
    	}
	}
	
	if (!bucket) {
		console.log("Cannot determine source S3 bucket! Set the `bucket` environment variable to specify the S3 bucket to process");
		return "OK";
	}
    
    try {
        let podcast = await Podcast.load(bucket);
        console.log('Podcast:', podcast);
		let storeRes = await storeRSS(podcast.toRSS(baseURL), bucket, feed_filename);
		console.log('Updated podcast RSS:', storeRes.ETag);
        return "OK";
    } catch (err) {
        console.log(err);
        throw new Error(`Failed to generate RSS feed for ${podcast_name}: ${err}`);
    }
};
