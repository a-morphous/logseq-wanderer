import { BlockEntity, PageEntity } from "@logseq/libs/dist/LSPlugin.user"
import { getBlockTitle, getBlockWithChildren, getFlattenedChildrenBlocks } from "./blockOperations"
import { hugoDate, secondsToHms } from "./time"
import JSZip from "jszip"
import { addImageToZip } from "./fileOperations"
import { handleClosePopup } from "../handleClosePopup"
import { download } from "./download"
import { saveAs } from 'file-saver';
import * as toml from "@iarna/toml"

export type TitleDetails = {
	noteName?: string
	hugoFileName?: string
}

export type DateDetails = {
	updatedDate?: string
	originalDate?: string
}

export type ParsedBlock = {
	metadata: Record<string, any>
	text: string
}

export type ParserOptions = {
	tags?: any[],
	title?: TitleDetails,
	date?: DateDetails,
	forceZip?: boolean
}

export class Parser {
	protected graphPath: string
	protected allPublicPages: Record<number, PageEntity> = {}
	protected allPublicLinks: string[] = []
	protected imageLinks: string[] = []
	public async generateZipForAllPages() {
		return await this.generateZip(undefined, {
			forceZip: true
		})
	}
	public async generateZip(block?: BlockEntity | undefined, opts: ParserOptions = {}) {
		this.graphPath = (await logseq.App.getCurrentGraph()).path
		this.imageLinks = []

		const zip = new JSZip()
		const query =
			"[:find (pull ?b [*]) :where [?b :block/properties ?pr] [(get ?pr :public) ?t] [(= true ?t)][?p :block/name ?n]]"
		const allPublicBlocks: BlockEntity[] = block ? [block] : await logseq.DB.datascriptQuery(query)
		const flatPublicBlocks = allPublicBlocks.flat()

		for (let block of flatPublicBlocks) {
			if (this.allPublicPages[block.page.id]) {
				continue
			}
			const page = await logseq.Editor.getPage(block.page.id)
			this.allPublicPages[block.page.id] = page
			this.allPublicLinks.push(page.originalName.toLocaleLowerCase())
		}

		const allBlockInfo: ParsedBlock[] = []

		for (let i = 0; i < flatPublicBlocks.length; i++) {
			const block = flatPublicBlocks[i]
			const blockInfo = await this.parseBlock(block, opts)
			allBlockInfo.push(blockInfo)
		}

		const promises = []
		for (const img of this.imageLinks) {
			promises.push(addImageToZip(zip, this.graphPath, img))
		}
		await Promise.all(promises)

		const existingPageContent: Record<number, string> = {}

		for (let i = 0; i < allBlockInfo.length; i++) {
			const block = flatPublicBlocks[i]
			const blockInfo = allBlockInfo[i]
			const page = await logseq.Editor.getPage(block.page.id)

			if (flatPublicBlocks.length == 1 && !opts.forceZip) {
				logseq.hideMainUI()
				handleClosePopup()
				download(`${blockInfo.metadata.title}`, `+++\n` + toml.stringify(blockInfo.metadata) + `\n+++\n\n` + blockInfo.text)
				return
			} else {
				console.log('adding block to zip', blockInfo)
				if (!existingPageContent[page.id]) {
					existingPageContent[page.id] =
						`+++\n` + toml.stringify(blockInfo.metadata) + `\n+++\n\n` + blockInfo.text
				} else {
					existingPageContent[page.id] += `\n\n${blockInfo.text}`
				}

				zip.file(
					`pages/${page.originalName.replaceAll(
						/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g,
						""
					)}.md`,
					existingPageContent[page.id]
				)
			}
		}

		const content = await zip.generateAsync({ type: "blob" })
		saveAs(content, "publicExport.zip")
	}

	protected async parseMeta(
		currentBlock: BlockEntity,
		titleDetails: TitleDetails = {},
		dateDetails: DateDetails = {},
		tagsArray: any[] = []
	) {
		const page = await logseq.Editor.getPage(currentBlock.page.id)
		let propList: Record<string, any> = {}

		//get all properties - fix later
		if (currentBlock.properties != undefined) {
			propList = currentBlock.properties
		}
		//Title
		//FIXME is filename used?
		propList.title = page.originalName
		propList.title = titleDetails.noteName ?? propList.title
		propList.fileName = titleDetails.hugoFileName ?? propList.title

		propList.blockTitle = getBlockTitle(currentBlock)

		//Tags
		propList.tags = currentBlock.properties.tags ? currentBlock.properties.tags : []
		if (tagsArray.length > 0) {
			let formattedTagsArray = []
			for (const tag in tagsArray) {
				formattedTagsArray.push(tagsArray[tag].tags)
			}
			if (propList.tags != undefined) {
				for (const tag in formattedTagsArray) {
					propList.tags.push(formattedTagsArray[tag])
				}
			} else {
				propList.tags = formattedTagsArray
			}
		}

		//Date - if not defined, convert Logseq timestamp
		propList.date = currentBlock.properties?.date ?? hugoDate(page.createdAt)
		propList.lastMod =
			currentBlock.properties?.lastmod ?? hugoDate(page.updatedAt)
		propList.date = dateDetails.originalDate ?? propList.date
		propList.lastMod = dateDetails.updatedDate ?? propList.lastMod

		//these properties should not be exported to Hugo
		const nope = ["filters", "public"]
		for (const nono of nope) {
			delete propList[nono]
		}

		return propList
	}

	protected async parseBlock(block: BlockEntity, parserOptions: ParserOptions = {}) {
		let finalString = ""
		const blockWithChildren = await getBlockWithChildren(block)
		const docTree = await getFlattenedChildrenBlocks(blockWithChildren)

		// parse text
		for (const x in docTree) {
			// skip meta-data
			if (!(parseInt(x) === 0)) {
				//parseText will return 'undefined' if a block skipped
				const ret = await this.parseText(docTree[x])
				if (typeof ret != "undefined") {
					finalString = `${finalString}\n${ret}`
				}
			}
		}

		// parse metadata
		const metadata = await this.parseMeta(block, parserOptions.title, parserOptions.date, parserOptions.tags)

		return {
			metadata,
			text: finalString,
		}
	}

	protected async parseText(block: BlockEntity) {
		//returns either a hugo block or `undefined`
		let re: RegExp
		let text = block.content
		let txtBefore: string = ""
		let txtAfter: string = "\n"
		const prevBlock: BlockEntity = await logseq.Editor.getBlock(block.left.id, {
			includeChildren: false,
		})

		//Block refs - needs to be at the beginning so the block gets parsed
		//FIXME they need some indicator that it *was* an embed
		const rxGetId = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/
		const rxGetEd =
			/{{embed \(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)}}/
		const blockId = rxGetEd.exec(text) || rxGetId.exec(text)
		if (blockId != null) {
			const block = await logseq.Editor.getBlock(blockId[1], {
				includeChildren: true,
			})

			if (block != null) {
				text = text.replace(blockId[0], block.content.substring(0, block.content.indexOf("id::")))
			}
		}

		//task markers - skip
		if (block.marker && !logseq.settings.exportTasks) return

		//Images
		//FIXME ![image.png](../assets/image_1650196318593_0.png){:class medium, :height 506, :width 321}
		//Logseq has extra info: height and width that can be used in an image template
		//Get regex to check if text contains a md image
		const reImage = /!\[.*?\]\((.*?)\)/g
		try {
			text.match(reImage).forEach((element) => {
				element.match(/(?<=!\[.*\])(.*)/g).forEach((match) => {
					let finalLink = match.substring(1, match.length - 1)
					text = text.replace(match, match.toLowerCase())
					if (!finalLink.includes("http") || !finalLink.includes(".pdf")) {
						text = text.replace("../", "/")
						this.imageLinks.push(finalLink)
						// addImageToZip(finalLink)
					}
				})
			})
		} catch (error) {}

		// FIXME for now all indention is stripped out
		// Add indention — level zero is stripped of "-", rest are lists
		// Experiment, no more lists, unless + or numbers
		// (unless they're not)
		if (logseq.settings.bulletHandling == "Convert Bullets") {
			if (block.level > 1) {
				txtBefore = " ".repeat((block.level - 1) * 2) + "+ "
				// txtBefore = "\n" + txtBefore
				if (prevBlock.level === block.level) txtAfter = ""
			}
		}
		if (prevBlock.level === block.level) txtAfter = ""
		//exceptions (logseq has "-" before every block, Hugo doesn't)
		if (text.substring(0, 3) === "```") txtBefore = ""
		// Don't - indent images
		if (reImage.test(text)) txtBefore = ""
		//indent text + add newline after block
		text = txtBefore + text + txtAfter

		//internal links
		text = await this.parseLinks(text)

		//namespaces
		text = await this.parseNamespaces(text, block.level)

		//Change {{youtube-timestamp ts}} via regex
		const yTimestamps = /{{youtube-timestamp (.*?)}}/g
		text = text.replaceAll(yTimestamps, (match) => {
			const timestampRegex = /{{youtube-timestamp ([0-9]+)}}/
			const timestamp = timestampRegex.exec(match)
			if (timestamp != null) {
				return `@${secondsToHms(timestamp[1])}`
			}
		})

		//youtube embed
		//Change {{youtube url}} via regex
		const reYoutube = /{{youtube(.*?)}}/g
		text = text.replaceAll(reYoutube, (match) => {
			const youtubeRegex = /(youtu(?:.*\/v\/|.*v\=|\.be\/))([A-Za-z0-9_\-]{11})/
			const youtubeId = youtubeRegex.exec(match)
			if (youtubeId != null) {
				return `{{< youtube ${youtubeId[2]} >}}`
			}
		})

		//height and width syntax regex
		// {:height 239, :width 363}
		const heightWidthRegex = /{:height\s*[0-9]*,\s*:width\s*[0-9]*}/g
		text = text.replaceAll(heightWidthRegex, "")

		//highlighted text, not supported in hugo by default!
		re = /(==(.*?)==)/gm
		text = text.replace(re, "{{< logseq/mark >}}$2{{< / logseq/mark >}}")

		re = /#\+BEGIN_([A-Z]*)[^\n]*\n(.*)#\+END_[^\n]*/gms
		text = text.replace(re, "{{< logseq/org$1 >}}$2{{< / logseq/org$1 >}}")
		// text = text.toLowerCase();

		text = text.replace(/:LOGBOOK:|collapsed:: true/gi, "")
		if (text.includes("CLOCK: [")) {
			text = text.substring(0, text.indexOf("CLOCK: ["))
		}

		if (text.indexOf(`\nid:: `) === -1) {
			return text
		} else {
			return text.substring(0, text.indexOf(`\nid:: `))
		}
	}

	private async parseLinks(text: string) {
		//returns text with all links converted

		// conversion of links to hugo syntax https://gohugo.io/content-management/cross-references/
		// Two kinds of links: [[a link]]
		//                     [A description]([[a link]])
		// Regular links are done by Hugo [logseq](https://logseq.com)
		const reLink: RegExp = /\[\[(.*?)\]\]/gim
		const reDescrLink: RegExp = /\[([a-zA-Z ]*?)\]\(\[\[(.*?)\]\]\)/gim

		// FIXME why doesn't this work?
		// if (! reDescrLink.test(text) && ! reLink.test(text)) return text

		let result: RegExpExecArray
		while ((result = reDescrLink.exec(text) || reLink.exec(text))) {
			if (this.allPublicLinks.includes(result[result.length - 1].toLowerCase())) {
				text = text.replace(
					result[0],
					`[${result[1]}]({{< ref "/pages/${result[result.length - 1]}" >}})`
				)
			}
		}
		if (logseq.settings.linkFormat == "Without brackets") {
			text = text.replaceAll("[[", "")
			text = text.replaceAll("]]", "")
		}
		return text
	}

	private async parseNamespaces(text: string, blockLevel: number) {
		const namespace: RegExp = /{{namespace\s([^}]+)}}/gim

		let result
		while ((result = namespace.exec(text))) {
			const currentNamespaceName = result[result.length - 1]

			const query = `[:find (pull ?c [*]) :where [?p :block/name "${currentNamespaceName.toLowerCase()}"] [?c :block/namespace ?p]]`
			let namespacePages = await logseq.DB.datascriptQuery(query)
			namespacePages = namespacePages?.flat() //FIXME is this needed?

			let txtBeforeNamespacePage: string = ""
			if (logseq.settings.bulletHandling == "Convert Bullets") {
				txtBeforeNamespacePage = " ".repeat(blockLevel * 2) + "+ "
			}

			let namespaceContent = `**Namespace [[${currentNamespaceName}]]**\n\n`
			if (this.allPublicLinks.includes(currentNamespaceName.toLowerCase())) {
				namespaceContent = namespaceContent.replace(
					`[[${currentNamespaceName}]]`,
					`[${currentNamespaceName}]({{< ref "/pages/${currentNamespaceName}" >}})`
				)
			}

			for (const page of namespacePages) {
				const pageOrigName = page["original-name"]
				if (this.allPublicLinks.includes(page["original-name"].toLowerCase())) {
					const pageName = pageOrigName.replace(`${currentNamespaceName}/`, "")
					namespaceContent = namespaceContent.concat(
						txtBeforeNamespacePage + `[${pageName}]({{< ref "/pages/${pageOrigName}" >}})\n\n`
					)
				}
			}

			text = text.replace(result[0], namespaceContent)
		}

		return text
	}
}
