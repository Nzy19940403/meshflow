import { SchemaBucket } from "../engine/bucket";
import { DefaultStrategy  } from "../types/types";

import { KeysOfUnion } from '../utils/util';
/**
 * @internal
*/
export const useSetStrategy = <P,NM>(Finder: any,GetBucket:(bucketId:number)=>SchemaBucket<P>) => {
    let GetByPath = Finder ? Finder : undefined;

    if (!GetByPath) {
        throw Error()
    }

    const SetStrategy = (path: P, key: KeysOfUnion<NM>, strategy: DefaultStrategy) => {
        let degree = GetByPath(path);
        const bucket = GetBucket(degree.nodeBucket[key])
        bucket._setStrategy(strategy);
    }

    return { SetStrategy }
}