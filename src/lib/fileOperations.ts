import JSZip from "jszip"

function getBase64Image(img: HTMLImageElement) {
	var canvas = document.createElement("canvas")
	canvas.width = img.width
	canvas.height = img.height
	var ctx = canvas.getContext("2d")
	ctx.drawImage(img, 0, 0)
	var dataURL = canvas.toDataURL("image/png")
	return dataURL.replace(/^data:image\/(png|jpg);base64,/, "")
}

export function addImageToZip(
	zip: JSZip,
	logseqGraphPath: string,
	filePath: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		var element = document.createElement("img")
		let formattedFilePath = filePath.replace("..", logseqGraphPath)
		element.setAttribute("src", formattedFilePath)
		element.style.display = "none"

		document.body.appendChild(element)
		setTimeout(() => {
			var base64 = getBase64Image(element)
			document.body.removeChild(element)
			if (base64 != "data:,") {
				zip.file(
					"assets/" + filePath.split("/")[filePath.split("/").length - 1].toLowerCase(),
					base64,
					{ base64: true }
				)
			} else {
				// console.log(base64);
			}
			resolve()
		}, 100)
	})
}
