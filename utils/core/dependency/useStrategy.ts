import { DefaultStrategy, SchemaBucket } from "../engine/bucket";

import { KeysOfUnion } from '../utils/util';

export const useSetStrategy = <P,NM>(Finder: any,GetBucket:any) => {
    let GetByPath = Finder ? Finder : undefined;

    if (!GetByPath) {
        throw Error()
    }

    const SetStrategy = (path: P, key: KeysOfUnion<NM>, strategy: DefaultStrategy) => {
        let degree = GetByPath(path);
        const bucket = GetBucket(degree.nodeBucket[key])
        bucket.setStrategy(strategy);
    }

    return { SetStrategy }
}