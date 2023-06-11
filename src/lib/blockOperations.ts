import { BlockEntity } from "@logseq/libs/dist/LSPlugin.user"

export async function getBlockWithChildren(block: BlockEntity) {
	const blockWithChildren = await logseq.Editor.getBlock(block.uuid, { includeChildren: true })
	return blockWithChildren
}

export async function getFlattenedChildrenBlocks(
	blockToExamine: BlockEntity,
	listofBlocks: BlockEntity[] = []
) {
	listofBlocks.push(blockToExamine)
	if (blockToExamine.children && blockToExamine.children.length) {
		for (let child of blockToExamine.children) {
			getFlattenedChildrenBlocks(child as BlockEntity, listofBlocks)
		}
	}
	return listofBlocks
}

export function getBlockTitle(block: BlockEntity): string {
	const possibleTitle = block.content.split("\n")[0]
	console.log(possibleTitle)
	if (!possibleTitle.startsWith("#")) {
		return possibleTitle.trim()
	}
	const splits = possibleTitle.split(" ")
	splits.shift()
	console.log(splits)
	return splits.join(" ").trim()
}
