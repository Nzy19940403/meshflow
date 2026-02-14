import { DefaultStarategy, SchemaBucket } from "../engine/bucket";
import { FormFieldSchema, GroupField } from "../schema/schema";
import { KeysOfUnion } from '../utils/util';

export const useSetStrategy = <P>(Finder: any) => {
    let GetByPath = Finder ? Finder : undefined;

    if (!GetByPath) {
        throw Error('')
    }

    const SetStrategy = (path: P, key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, strategy: DefaultStarategy) => {
        let degree = GetByPath(path);

        (degree.nodeBucket[key] as SchemaBucket<P>).setStrategy(strategy);
    }

    return { SetStrategy }
}