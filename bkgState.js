'use strict';

const RESET_AFTER_HOURS = 6;
const HOUR = 36e5; // 60 * 60 * 1000;

const localBytes = promisify(local.getBytesInUse.bind(local));
const tabsQuery = promisify(chrome.tabs.query.bind(chrome.tabs));

const appendHistory = (() => {
	const fmt = (v, unit, p = 2) => `${v.toPrecision(p)}${unit}`;
	const toMB = v => fmt(v / (1 << 20), 'MB');

	const queue = [];

	async function trimStorageIfNeeded(history) {
		const used = await localBytes(null);

		if (used < .9 * local.QUOTA_BYTES) {
			return [history, used];
		}

		const excess = Math.floor(history.length * .1);

		console.warn('WARNING: Used storage exceeds 90% of allowed quota, trimming oldest entries…', {
			storage: {
				allowed: toMB(local.QUOTA_BYTES),
				used: toMB(used),
				percent: fmt(100 * used / local.QUOTA_BYTES, '%')
			},
			rows: {
				current: history.length,
				'to be trimmed': excess
			}
		});

		return [history.slice(-excess), used];
	}

	async function append(event) {
		let used, {history = []} = await localGet('history');

		[history, used] = await trimStorageIfNeeded(history);

		if (event.event === 'reset') {
			event.usedStorage = fmt(100 * used / local.QUOTA_BYTES, '%');
		}

		history.push(event);

		await localSet({history});
	}

	return (eventName, data) => {
		data.event = eventName;

		const promise = Promise.all(queue)
			.then(() => append(data)).catch()
			.then(() => void queue.shift());

		queue.push(promise);
	};
})();


//
//	Manage global counts of tabs.
//
// Responsibilities:
//	* Restore from storage upon init
//	* Save to storage on change
//	* Keep counts of: opened/closed/delta since session start
//	* Keep track of time of last change, and
//		* Reset self when that time is longer than RESET_AFTER_HOURS hours
class Tabs {
	constructor() {
		this.ready = this.restore();
	}

	async restore() {
		return this.setTo((await localGet('last')).last);
	}

	async setTo({ts, base, opened = 0, closed = 0} = {}) {
		this.base = base || await this.currentTabs();
		this.opened = opened;
		this.closed = closed;

		if (!ts) {
			ts = +new Date;
			await localSet({start: ts});
		}
		this.ts = ts;
	}

	async currentTabs() {
		return (await tabsQuery({})).length;
	}

	async increment(prop, data) {
		await this.ready;

		if (this.expired) {
			await this.reset();
		}

		this.ts = +new Date;
		this[prop]++;

		const last = await this.save();

		if (data) {
			last.data = data;
		}

		return appendHistory(`${prop}Tab`, last);
	}

	inc(data) {
		return this.increment('opened', data);
	}

	dec(data) {
		return this.increment('closed', data);
	}

	get expired() {
		return (+new Date - this.ts) >= (RESET_AFTER_HOURS * HOUR);
	}

	async reset() {
		const now = +new Date;
		const {start} = await localGet('start');

		const o = {
			ts: now,
			session: {start}
		};

		if (this.ts) {
			o.break = {
				start: this.ts,
				end: now,
				duration: now - this.ts
			};

			o.session = {
				...o.session,
				end: this.ts,
				duration: this.ts - start
			};
		}

		await appendHistory('reset', o);

		return this.setTo({});
	}

	async save() {
		// Get prop values from all getters
		const {total, delta, expired} = this;

		// Combining "raw props" with all "getter props"
		const last = {
			...this, // "raw"
			total, delta, expired // "getters"
		};

		delete last.ready;

		await localSet({last});

		return last;
	}

	get total() {
		return this.base + this.delta;
	}

	get delta() {
		return this.opened - this.closed;
	}
}

const allTabs = new Tabs();

const inc = async ({id, windowId, openerTabId}) => allTabs.inc({id, windowId, openerTabId});
const dec = id => allTabs.dec({id});

chrome.tabs.onCreated.addListener(inc);
chrome.tabs.onRemoved.addListener(dec);

chrome.runtime.onMessage.addListener((data, sender) => appendHistory(undefined, {sender, data}));

