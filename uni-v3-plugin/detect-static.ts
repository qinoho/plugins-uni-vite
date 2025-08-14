import { parse } from '@vue/compiler-sfc'
import path from 'path'
import type { Plugin } from 'vite'

// 配置项类型
type ReplacementFn = (
  originalPath: string,
  resolvedPath: string
) => string | null | undefined
export interface DetectStaticOptions {
  extensions?: string[]
  replacementFn?: ReplacementFn
  // 支持传入多个具名替换函数（可选），将依次尝试，返回第一个有效结果
  replacements?: Record<string, ReplacementFn>
  srcRoot?: string
  enableReplace?: boolean
}

// 内部结构类型
interface ImportInfo {
  originalPath: string
  resolvedPath: string
}
interface ReplacementLogEntry {
  type: string
  original: string
  replacement: string
}

export default function detectTemplateAssets(
  options: DetectStaticOptions = {}
): Plugin {
  const {
    extensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'],
    replacementFn,
    srcRoot = 'src',
    enableReplace = false, // 是否启用替换功能
    // 兼容传入多个命名替换函数（将逐个尝试）
    replacements,
  } = options

  const detectedAssets = new Set<string>()
  const importMap = new Map<
    string,
    { originalPath: string; resolvedPath: string }
  >()
  const replacementLog = new Map<
    string,
    Array<{ type: string; original: string; replacement: string }>
  >() // 记录替换日志

  // 工具函数
  const isStaticAsset = (assetPath: string): boolean => {
    if (assetPath.startsWith('http') || assetPath.startsWith('data:')) {
      return false
    }
    if (!assetPath.includes('.')) {
      return false
    }
    const ext = path.extname(assetPath).toLowerCase()
    return extensions.includes(ext)
  }

  const resolvePath = (assetPath: string, currentFile: string): string => {
    if (assetPath.startsWith('@/')) {
      return path.resolve(srcRoot, assetPath.slice(2))
    }
    if (assetPath.startsWith('./') || assetPath.startsWith('../')) {
      const currentDir = path.dirname(currentFile)
      return path.resolve(currentDir, assetPath)
    }
    if (path.isAbsolute(assetPath)) {
      return assetPath
    }
    return path.resolve(srcRoot, assetPath)
  }

  const findReplacement = (
    resolvedPath: string,
    originalPath: string
  ): string => {
    // 只支持函数式替换
    if (typeof replacementFn === 'function') {
      const result = replacementFn(originalPath, resolvedPath)
      if (result) return result
    }
    return originalPath
  }

  const logReplacement = (
    type: string,
    original: string,
    replacement: string,
    file: string
  ): void => {
    if (!replacementLog.has(file)) {
      replacementLog.set(file, [])
    }
    const arr = replacementLog.get(file)
    if (arr) arr.push({ type, original, replacement })
  }

  return {
    name: 'detect-two',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.vue')) return

      try {
        const { descriptor } = parse(code)
        let hasChanges = false
        let newCode = code

        // 处理 script 部分的 import
        if (descriptor.script || descriptor.scriptSetup) {
          const script = descriptor.script || descriptor.scriptSetup
          let scriptContent: string = script.content

          const importRegex =
            /import\s+(?:(\w+)|{([^}]+)}|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g
          let match: RegExpExecArray | null

          while ((match = importRegex.exec(scriptContent)) !== null) {
            const [
              fullMatch,
              defaultImport,
              namedImports,
              namespaceImport,
              importPath,
            ] = match

            if (isStaticAsset(importPath)) {
              const resolvedPath = resolvePath(importPath, id)

              if (defaultImport) {
                importMap.set(defaultImport, {
                  originalPath: importPath,
                  resolvedPath,
                })
                console.log(
                  `📦 检测到默认导入资源: ${defaultImport} -> ${importPath}==${resolvedPath}`
                )

                // 检查是否需要替换 import 路径
                if (enableReplace) {
                  const replacement = findReplacement(resolvedPath, importPath)
                  if (replacement) {
                    // 检查替换目标是否为线上地址
                    if (replacement.startsWith('http')) {
                      // 将 import 转换为变量赋值
                      const newStatement = `const ${defaultImport} = '${replacement}'`
                      scriptContent = scriptContent.replace(
                        fullMatch,
                        newStatement
                      )
                      logReplacement(
                        'import-to-url',
                        importPath,
                        replacement,
                        id
                      )
                      console.log(
                        `🔄 替换导入为URL变量: ${defaultImport} = '${replacement}'`
                      )
                    } else {
                      // 普通路径替换
                      const newImportStatement = fullMatch.replace(
                        importPath,
                        replacement
                      )
                      scriptContent = scriptContent.replace(
                        fullMatch,
                        newImportStatement
                      )
                      logReplacement('import', importPath, replacement, id)
                      console.log(
                        `🔄 替换导入路径: ${importPath} -> ${replacement}`
                      )
                    }
                    hasChanges = true
                  }
                }
              }
            }
          }

          // 更新 script 内容
          if (hasChanges && scriptContent !== script.content) {
            newCode = newCode.replace(script.content, scriptContent)
          }
        }

        // 处理 template 部分
        if (descriptor.template) {
          let templateContent = descriptor.template.content

          // 处理静态 src
          const staticSrcRegex = /(?<!:)src\s*=\s*["']([^"']+)["']/g
          templateContent = templateContent.replace(
            staticSrcRegex,
            (match: string, assetPath: string) => {
              if (isStaticAsset(assetPath)) {
                const resolvedPath = resolvePath(assetPath, id)
                detectedAssets.add(resolvedPath)
                console.log(
                  `📦 检测到静态资源: ${assetPath} -> ${resolvedPath}`
                )
                if (enableReplace) {
                  const replacement = findReplacement(resolvedPath, assetPath)
                  if (replacement) {
                    logReplacement(
                      'template-static',
                      assetPath,
                      replacement,
                      id
                    )
                    console.log(match.replace(assetPath, replacement))
                    return match.replace(assetPath, replacement)
                  }
                }
              }

              return match
            }
          )
          // 处理动态绑定
          const dynamicSrcRegex = /:src\s*=\s*["']([^"']+)["']/g
          templateContent = templateContent.replace(
            dynamicSrcRegex,
            (match: string, bindingValue: string) => {
              if (importMap.has(bindingValue)) {
                const rec = importMap.get(bindingValue)!
                const { resolvedPath } = rec
                detectedAssets.add(resolvedPath)
                console.log(
                  `📦 检测到动态绑定资源: ${bindingValue} -> ${resolvedPath}`
                )
              } else {
                console.log(
                  `⚠️  检测到动态绑定: ${bindingValue} (在 ${id}) - 需要手动检查`
                )
              }
              return match
            }
          )

          // 处理 CSS url()
          const urlRegex = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/g
          templateContent = templateContent.replace(
            urlRegex,
            (match: string, assetPath: string) => {
              if (isStaticAsset(assetPath)) {
                const resolvedPath = resolvePath(assetPath, id)
                detectedAssets.add(resolvedPath)
                console.log(`📦 检测到CSS资源: ${assetPath} -> ${resolvedPath}`)

                if (enableReplace) {
                  const replacement = findReplacement(resolvedPath, assetPath)
                  if (replacement) {
                    logReplacement('css-url', assetPath, replacement, id)
                    console.log(
                      `🔄 替换CSS资源: ${assetPath} -> ${replacement}`
                    )
                    return match.replace(assetPath, replacement)
                  }
                }
              }
              return match
            }
          )

          if (templateContent !== descriptor.template.content) {
            hasChanges = true
            newCode = newCode.replace(
              descriptor.template.content,
              templateContent
            )
          }
        }

        return hasChanges ? { code: newCode, map: null } : null
      } catch (error) {
        console.warn(`解析 Vue 文件失败: ${id}`, error)
      }
    },

    buildStart() {
      console.log('🔍 开始检测模板中的静态资源...')
      detectedAssets.clear()
      importMap.clear()
      replacementLog.clear()
    },

    buildEnd() {
      console.log('\n📊 检测结果汇总:')
      console.log(`共检测到 ${detectedAssets.size} 个静态资源:`)
      detectedAssets.forEach(asset => {
        console.log(`  - ${asset}`)
      })

      if (enableReplace && replacementLog.size > 0) {
        console.log('\n🔄 替换操作汇总:')
        replacementLog.forEach((replacements, file) => {
          console.log(`\n文件: ${file}`)
          replacements.forEach(({ type, original, replacement }) => {
            console.log(`  [${type}] ${original} -> ${replacement}`)
          })
        })
      }
    },
  }
}
