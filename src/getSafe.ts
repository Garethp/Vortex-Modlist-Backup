/**
 * return an item from state or the fallback if the path doesn't lead
 * to an item.
 *
 * @export
 * @template T
 * @param {*} state
 * @param {string[]} path
 * @param {T} fallback
 * @returns {T}
 */
export default function getSafe<T>(state: any, path: Array<(string | number)>, fallback: T): T {
    let current = state;
    for (const segment of path) {
        if ((current === undefined) || (current === null) || !current.hasOwnProperty(segment)) {
            return fallback;
        } else {
            current = current[segment];
        }
    }
    return current;
}
