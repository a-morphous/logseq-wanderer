export function secondsToHms(d) {
	d = Number(d)
	var h = Math.floor(d / 3600)
	var m = Math.floor((d % 3600) / 60)
	var s = Math.floor((d % 3600) % 60)
	var hDisplay = h > 9 ? String(h) : "0" + String(h)
	var mDisplay = m > 9 ? String(m) : "0" + String(m)
	var sDisplay = s > 9 ? String(s) : "0" + String(s)
	return hDisplay + ":" + mDisplay + ":" + sDisplay
}

export function hugoDate(timestamp: number) {
	let date = new Date(timestamp)

	//if date.getdate does not have a zero, add A ZERO BEFORE IT
	let month: string
	if (date.getMonth() + 1 < 10) {
		month = `0${date.getMonth() + 1}`
	} else {
		month = `${date.getMonth() + 1}`
	}
	let day: string
	if (date.getDate() < 10) {
		day = `0${date.getDate()}`
	} else {
		day = `${date.getDate()}`
	}

	return `${date.getFullYear()}-${month}-${day}`
}
