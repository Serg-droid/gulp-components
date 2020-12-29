const 
    through2 = require('through2'),
    cheerio = require('cheerio'),
    path = require('path'),
    fs = require('fs'),
    util = require('util'),
    css = require('css')

const readdir = util.promisify(fs.readdir),
      stat = util.promisify(fs.stat),
      readFile = util.promisify(fs.readFile)
      // writeFile = util.promisify(fs.writeFile)


let components = null
let options

function uniqid() {
  let id = ''
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  for (let i = 0; i < Math.floor(8 - Math.random() * 2); i++) {
    const index = Math.floor(Math.random() * letters.length)
    id += letters[index]
  }
  return id
}

// -------------- styles 

async function getComponentStyles(componentPath) {
  try {
    const scss = await readFile(path.join(componentPath, 'style.scss'))
    return scss
  } catch (e) {

  }
}

function changeScssDocument(scssDocument) {
  let componentsScss = Object.keys(components).map(componentName => {
    const changedStyles = addUniqIdsToSelectors(
      components[componentName].styles, 
      components[componentName].id
    )
    return changedStyles
  }).join(' ')

  return componentsScss + " " + scssDocument
}

function addUniqIdsToSelectors(styles, id) {
  const stylesObj = css.parse(styles)
  stylesObj.stylesheet && stylesObj.stylesheet.rules && stylesObj.stylesheet.rules.forEach(rule => {
    rule.selectors = rule.selectors.map(selector => `${selector[0]}${id}-${selector.slice(1)}`)
  })

  return css.stringify(stylesObj)
}

// --------------
// -------------- scripts

async function getComponentScript(componentPath) {
  try {
    const js = await readFile(path.join(componentPath, 'script.js'))
    return js
  } catch (e) {

  }
}

function changeScriptDocument(jsDocument) {
  let componentScript = Object.keys(components).map(componentName => {
    const changedScript = isolateScriptAndAddUniqIds(
      components[componentName].script,
      components[componentName].id
    )
    return changedScript
  }).join(';')

  return componentScript + '; ' + jsDocument
}

function isolateScriptAndAddUniqIds(scriptText, id) {
  const regExp = /(?<=querySelector(All)?\(['"]).*(?=["']\))/g
  const newScriptText = scriptText.replace(regExp, (match) => {
    return `${match[0]}${id}-${match.slice(1)}`
  })

  return `(function() {
    ${newScriptText}
  })()`
}

// --------------

function changeHtmlDocument(htmlDocument) {
  const $ = cheerio.load(htmlDocument)

  const componentsNames = Object.keys(components)
  componentsNames.forEach(name => {
    const $elems = $(name)

    $elems.each((i, $el) => {
      if ($el && $el && $el.type === 'tag') {
        const customClasses = $el.attribs 
          && $el.attribs.class 
          && $el.attribs.class.split(' ')
        const componentsHtml = createUniqAttributes(components[name].html, components[name].id, customClasses)
        $($el).replaceWith(componentsHtml)
      }
    })
  })

  return $.html()
}

function createUniqAttributes(el, componentId, customClasses) {
  const component = cheerio(el)
  const $component = component[0]
  if (!$component || $component.type !== 'tag') {
    return 
  }
  // console.log('RECURSIVE: --------------------', $component.name)

  const classes = $component.attribs 
    && $component.attribs.class 
    && $component.attribs.class.split(' ').map(className => `${componentId}-${className}`)
  const id = $component.attribs && $component.attribs.id

  classes && component.attr('class', classes.join(' '))
  id && component.attr('id', `${componentId}-${id}`)
  // console.log('customClasses: ', customClasses)
  if (customClasses) {
    customClasses.forEach(className => {
      component.addClass(className)
    })
  }

  const children = $component.children
  children && children.forEach(child => createUniqAttributes(child, componentId))
  return cheerio.html($component)
}

async function getComponentHtml(componentPath) {
  try {
    const html = await readFile(path.join(componentPath, 'index.html'))
    return html
  } catch (e) {

  }
}

async function isAllNecessaryFilesPresented(path) {
  try {
    const files = await readdir(path)
    return !!~files.indexOf('index.html') && !!~files.indexOf('script.js') && !!~files.indexOf('style.scss')
  } catch(e) {
    console.log('Not all files inside component\'s dir are presented')
    console.log(e)
    return false
  } 
}

async function extractComponents(dir) {
  const components = {}
  try {
    const files = await readdir(path.join(__dirname, dir))

    await Promise.all(files.map(async (fileName) => {
      const pathToComponentDir = path.join(__dirname, dir, fileName)
      if (await isComponentValid(pathToComponentDir)) {
        components[fileName] = {}
        components[fileName].id = uniqid()
        components[fileName].html = (await getComponentHtml(pathToComponentDir)).toString()
        components[fileName].styles = (await getComponentStyles(pathToComponentDir)).toString()
        components[fileName].script = (await getComponentScript(pathToComponentDir)).toString()
        components[fileName].rootDir = pathToComponentDir
      }
    }))

    return components
  } catch(e) {
    console.log('error in extractComponents')
    console.log(e)
  }
}

async function isComponentValid(pathToComponentDir) {
  const componentDirStat = await stat(path.join(pathToComponentDir))
  return componentDirStat.isDirectory() && await isAllNecessaryFilesPresented(pathToComponentDir)
}

module.exports.setup = opts => {
  options = opts
}

module.exports.clearCache = () => {
  components = null
}

module.exports.prepareScss = () => {
  return through2.obj(async (file, enc, next) => {
    if (components === null) {
      components = await extractComponents(options.componentsDir)
    }

    if (file.isNull()) {
      next(null, file);
      return;
    }

    if (file.isBuffer()) {
      const scssDocument = file.contents.toString()
      const newScss = changeScssDocument(scssDocument)
      file.contents = Buffer.from(newScss)
      // console.log('scss-components are made')
      next(null, file)
    }
  })
}

module.exports.prepareHtml = () => {
  return through2.obj(async (file, enc, next) => {
    if (components === null) {
      components = await extractComponents(options.componentsDir)
    }

    if (file.isNull()) {
      next(null, file);
      return;
    }

    if (file.isBuffer()) {
      const htmlDocument = file.contents.toString()
      const newHtml = changeHtmlDocument(htmlDocument)
      file.contents = Buffer.from(newHtml)
      // console.log('html-components are made')
      next(null, file)
    }
  })
}

module.exports.prepareScripts = () => {
  return through2.obj(async (file, enc, next) => {
    if (components === null) {
      components = await extractComponents(options.componentsDir)
    }

    if (file.isNull()) {
      next(null, file);
      return;
    }

    if (file.isBuffer()) {
      const jsDocument = file.contents.toString()
      const newJs = changeScriptDocument(jsDocument)
      file.contents = Buffer.from(newJs)
      // console.log('js-components are made')
      next(null, file)
    }
  })
}