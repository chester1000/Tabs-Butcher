'use strict';

const promisify = (fn, bind) => arg => new Promise(resolve => fn.bind(bind)(arg, resolve));

const {local} = chrome.storage;

const localGet = promisify(local.get.bind(local));
const localSet = promisify(local.set.bind(local));

// Takes timestamp ts, and returns it formatted as either:
//	if (ago == true)  => "2020-12-31 23:59:59"
//	if (ago == false) => "29 minutes ago"
function fmtDate(ts, ago = true) {
	if (!ago) {
		return new Date(ts).toLocaleString('sv');
	}

	const UNITS = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'];
	const SEC_ARRAY = [60, 60, 24, 7, 365 / 7 / 12, 12];

	let diff = (+new Date - ts) / 1000;
	let idx = 0;

	for (; diff >= SEC_ARRAY[idx] && idx < SEC_ARRAY.length; idx++) {
		diff /= SEC_ARRAY[idx];
	}

	diff = Math.floor(diff);
	idx *= 2;
	if (diff > (idx === 0 ? 9 : 1)) idx += 1;

	if (idx === 0) return 'just now';
	let unit = UNITS[Math.floor(idx / 2)];
	if (diff > 1) unit += 's';
	return `${diff} ${unit} ago`;
}
