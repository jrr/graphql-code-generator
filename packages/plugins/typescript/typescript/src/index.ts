import { Types, PluginFunction } from '@graphql-codegen/plugin-helpers';
import { parse, printSchema, visit, GraphQLSchema, TypeInfo, GraphQLNamedType, visitWithTypeInfo, getNamedType, isIntrospectionType, DocumentNode, printIntrospectionSchema, isObjectType } from 'graphql';
import { RawTypesConfig } from '@graphql-codegen/visitor-plugin-common';
import { TsVisitor } from './visitor';
import { TsIntrospectionVisitor } from './introspection-visitor';
import { AvoidOptionalsConfig } from './types';
export * from './typescript-variables-to-object';
export * from './visitor';
export { AvoidOptionalsConfig } from './types';

export interface TypeScriptPluginConfig extends RawTypesConfig {
  /**
   * @name avoidOptionals
   * @type boolean
   * @description This will cause the generator to avoid using TypeScript optionals (`?`) on types,
   * so the following definition: `type A { myField: String }` will output `myField: Maybe<string>`
   * instead of `myField?: Maybe<string>`.
   * @default false
   *
   * @example Override all definition types
   * ```yml
   * generates:
   * path/to/file.ts:
   *  plugins:
   *    - typescript
   *  config:
   *    avoidOptionals: true
   * ```
   *
   * @example Override only specific definition types
   * ```yml
   * generates:
   * path/to/file.ts:
   *  plugins:
   *    - typescript
   *  config:
   *    avoidOptionals:
   *      inputValue: true
   * ```
   *
   */
  avoidOptionals?: boolean | AvoidOptionalsConfig;
  /**
   * @name constEnums
   * @type boolean
   * @description Will prefix every generated `enum` with `const`, you can read more
   * about const enums {@link https://www.typescriptlang.org/docs/handbook/enums.html|here}.
   * @default false
   *
   * @example
   * ```yml
   * generates:
   * path/to/file.ts:
   *  plugins:
   *    - typescript
   *  config:
   *    constEnums: true
   * ```
   */
  constEnums?: boolean;
  /**
   * @name enumsAsTypes
   * @type boolean
   * @description Generates enum as TypeScript `type` instead of `enum`. Useful it you wish to genereate `.d.ts` declartion file instead of `.ts`
   * @default false
   *
   * @example
   * ```yml
   * generates:
   * path/to/file.ts:
   *  plugins:
   *    - typescript
   *  config:
   *    enumsAsTypes: true
   * ```
   */
  enumsAsTypes?: boolean;
  /**
   * @name immutableTypes
   * @type boolean
   * @description Generates immutable types by adding `readonly` to properties and uses `ReadonlyArray`.
   * @default false
   *
   * @example
   * ```yml
   * generates:
   * path/to/file.ts:
   *  plugins:
   *    - typescript
   *  config:
   *    immutableTypes: true
   * ```
   */
  immutableTypes?: boolean;
  /**
   * @name maybeValue
   * @type string
   * @description Allow to override the type value of `Maybe`.
   * @default T | null
   *
   * @example Allow undefined
   * ```yml
   * generates:
   * path/to/file.ts:
   *  plugins:
   *    - typescript
   *  config:
   *    maybeValue: T | null | undefined
   * ```
   */
  maybeValue?: string;
  /**
   * @name noExport
   * @type boolean
   * @description Set the to `true` in order to generate output without `export` modifier.
   * This is useful if you are generating `.d.ts` file and want it to be globally available.
   * @default false
   *
   * @example Disable all export from a file
   * ```yml
   * generates:
   * path/to/file.ts:
   *  plugins:
   *    - typescript
   *  config:
   *    noExport: true
   * ```
   */
  noExport?: boolean;
  /**
   * @name generateOnly
   * @type string
   * @description Set the to `enums` in order to generate output containing only enums.
   * This is useful if you'd like to generate a second file with an opposite enumsAsTypes selection.
   * @default undefined
   *
   * @example Disable all export from a file
   * ```yml
   * generates:
   * path/to/file.ts:
   *  plugins:
   *    - typescript
   *  config:
   *    generateOnly:
   *      - enums
   * ```
   */
  generateOnly?: ['enums'];
}

export const plugin: PluginFunction<TypeScriptPluginConfig> = (schema: GraphQLSchema, documents: Types.DocumentFile[], config: TypeScriptPluginConfig) => {
  const visitor = new TsVisitor(schema, config);
  const printedSchema = printSchema(schema);
  const astNode = parse(printedSchema);
  const maybeValue = visitor.getMaybeValue();
  const visitorResult = visit(astNode, { leave: visitor });
  const introspectionDefinitions = includeIntrospectionDefinitions(schema, documents, config);
  const scalars = visitor.scalarsDefinition;

  if (config.generateOnly && config.generateOnly.length > 0 && config.generateOnly[0] === 'enums') {
    return {
      prepend: [ ],
      content: [visitorResult.definitions.filter(d => d.includes('export enum'))].join('\n'),
    };
  }
  return {
    prepend: [...visitor.getEnumsImports(), ...visitor.getScalarsImports(), maybeValue],
    content: [scalars, ...visitorResult.definitions, ...introspectionDefinitions].join('\n'),
  };
};

export function includeIntrospectionDefinitions(schema: GraphQLSchema, documents: Types.DocumentFile[], config: TypeScriptPluginConfig): string[] {
  const typeInfo = new TypeInfo(schema);
  const usedTypes: GraphQLNamedType[] = [];
  const documentsVisitor = visitWithTypeInfo(typeInfo, {
    Field() {
      const type = getNamedType(typeInfo.getType());

      if (isIntrospectionType(type) && !usedTypes.includes(type)) {
        usedTypes.push(type);
      }
    },
  });

  documents.forEach(doc => visit(doc.content, documentsVisitor));

  const typesToInclude: GraphQLNamedType[] = [];

  usedTypes.forEach(type => {
    collectTypes(type);
  });

  const visitor = new TsIntrospectionVisitor(schema, config, typesToInclude);
  const result: DocumentNode = visit(parse(printIntrospectionSchema(schema)), { leave: visitor });

  // recursively go through each `usedTypes` and their children and collect all used types
  // we don't care about Interfaces, Unions and others, but Objects and Enums
  function collectTypes(type: GraphQLNamedType): void {
    if (typesToInclude.includes(type)) {
      return;
    }

    typesToInclude.push(type);

    if (isObjectType(type)) {
      const fields = type.getFields();

      Object.keys(fields).forEach(key => {
        const field = fields[key];
        const type = getNamedType(field.type);
        collectTypes(type);
      });
    }
  }

  return result.definitions as any[];
}

export { TsVisitor, TsIntrospectionVisitor };
