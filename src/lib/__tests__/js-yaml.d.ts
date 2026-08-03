/**
 * js-yaml.d.ts — declaração ambiente mínima para o módulo `js-yaml`.
 *
 * POR QUE EXISTE: `js-yaml` é dep TRANSITIVA (não declarada no package.json)
 * e NÃO possui @types. O teste tier1-fastpath-guard-workflow.test.ts importa
 * `yaml` para validar a sintaxe YAML do workflow periódico — sem esta
 * declaração, o tsc --noEmit (strict) falha com TS7016.
 *
 * POR QUE um .d.ts GLOBAL e não `declare module` inline no teste: num arquivo
 * de módulo (com imports/exports), `declare module "js-yaml"` é interpretado
 * como AUGMENTATION (TS2665: "Invalid module name in augmentation") porque o
 * módulo não existe com tipos. Num .d.ts SEM imports/exports no topo (script
 * global), `declare module` é uma declaração ambiente válida.
 *
 * ATENÇÃO: se @types/js-yaml for instalado no futuro, esta declaração entra em
 * conflito (duplicate identifier) — remova este arquivo nesse momento.
 *
 * Apenas a superfície usada pelo teste é declarada (load); o retorno unknown
 * força o cast explícito no consumidor.
 */
declare module "js-yaml" {
  const yaml: {
    load(input: string): unknown
  }
  export default yaml
}
