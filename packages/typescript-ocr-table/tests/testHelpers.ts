// Remove normal hyphens, en dashes, and em dashes, as well as any other similar dash characters.
// Also consolidates whitespace.
export const _removeDashes = (obj: any): any => {
  let jsonString = JSON.stringify(obj);

  jsonString = jsonString.replaceAll(`-`, ' ');
  jsonString = jsonString.replaceAll(`–`, ' ');
  jsonString = jsonString.replaceAll(`—`, ' ');

  // We also need to convert all whitespace (except newlines) to regular spaces,
  // and consolidate multiple spaces into one.
  // Do this with a series of string replacements instead of regex, because
  // humans can't read regexes.
  jsonString = jsonString.replaceAll(`\t`, ' ');
  jsonString = jsonString.replaceAll(`\r`, ' ');
  jsonString = jsonString.replaceAll(/ +/g, ' ');

  return JSON.parse(jsonString);
};

// Goes through each object key by key and deep-compares the values, counting how many differences
// there are. If a value is an object, it recursively compares the nested keys. If a value is an
// array, it compares the arrays element by element. It returns the total count of differences
// between the two objects.
export const _countObjectDifferences = (obj1: any, obj2: any): number => {
  let differences = 0;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  const allKeys = new Set([...keys1, ...keys2]);

  for (const key of allKeys) {
    const val1 = obj1[key];
    const val2 = obj2[key];
    if (typeof val1 === 'object' && typeof val2 === 'object') {
      differences += _countObjectDifferences(val1, val2);
    } else if (Array.isArray(val1) && Array.isArray(val2)) {
      const maxLength = Math.max(val1.length, val2.length);
      for (let i = 0; i < maxLength; i++) {
        differences += _countObjectDifferences(val1[i], val2[i]);
      }
    } else if (val1 !== val2) {
      differences += 1;
    }
  }

  return differences;
};
