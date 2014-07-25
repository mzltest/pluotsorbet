/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

function Context() {
  this.frames = [];
}

Context.prototype.current = function() {
  var frames = this.frames;
  return frames[frames.length - 1];
}

Context.prototype.pushFrame = function(methodInfo, consumes) {
  var caller = this.current();
  var callee = new Frame(methodInfo);
  callee.locals = caller.stack;
  callee.localsBase = caller.stack.length - consumes;
  this.frames.push(callee);
  return callee;
}

Context.prototype.popFrame = function() {
  var callee = this.frames.pop();
  var caller = this.current();
  if (callee.localsBase)
    caller.stack.length = callee.localsBase;
  return caller;
}

Context.prototype.monitorEnter = function(obj) {
  var lock = obj.lock;
  if (!lock) {
    obj.lock = { thread: this.thread, count: 1, waiters: [] };
    return;
  }
  if (lock.thread === this.thread) {
    ++lock.count;
    return;
  }
  lock.waiters.push(this);
  throw VM.Pause;
}

Context.prototype.monitorLeave = function(obj) {
  var lock = obj.lock;
  if (lock.thread !== this.thread) {
    console.log("WARNING: thread tried to unlock a monitor it didn't own");
    return;
  }
  if (--lock.count > 0) {
    return;
  }
  var waiters = lock.waiters;
  obj.lock = null;
  for (var n = 0; n < waiters.length; ++n)
    window.setZeroTimeout(VM.execute.bind(null, waiters[n]));
}

Context.prototype.pushClassInitFrame = function(classInfo) {
  if (classInfo.initialized)
    return;
  if (classInfo.superClass)
    this.pushClassInitFrame(classInfo.superClass);
  classInfo.initialized = true;
  classInfo.staticFields = {};
  classInfo.constructor = function () {
  }
  classInfo.constructor.prototype.class = classInfo;
  var clinit = CLASSES.getMethod(classInfo, "<clinit>", "()V", true, false);
  if (!clinit)
    return;
  this.pushFrame(clinit, 0);
}

Context.prototype.backTrace = function() {
  var stack = [];
  this.frames.forEach(function(frame) {
    var methodInfo = frame.methodInfo;
    var className = methodInfo.classInfo.className;
    var methodName = methodInfo.name;
    var signature = Signature.parse(methodInfo.signature);
    var IN = signature.IN;
    var args = [];
    var lp = 0;
    for (var n = 0; n < IN.length; ++n) {
      var arg = frame.locals[frame.localsBase + lp];
      ++lp;
      switch (IN[n].type) {
      case "long":
      case "double":
        ++lp;
        break;
      case "object":
        if (arg === null)
          arg = "null";
        else if (arg.class.className === "java/lang/String")
          arg = "'" + util.fromJavaString(arg) + "'";
        else
          arg = "<" + arg.class.className + ">";
      }
      args.push(arg);
    }
    stack.push(methodInfo.classInfo.className + "." + methodInfo.name + "(" + args.join(",") + ")");
  });
  return stack.join("\n");
}

Context.prototype.raiseException = function(className, message) {
  if (!message)
    message = "";
  message = "" + message;
  var syntheticMethod = {
    classInfo: {
      constant_pool: [
        null,
        { name_index: 2 },
        { bytes: className },
        { tag: TAGS.CONSTANT_String, string_index: 4 },
        { bytes: message },
        { class_index: 1, name_and_type_index: 6 },
        { name_index: 7, signature_index: 8 },
        { bytes: "<init>" },
        { bytes: "(Ljava/lang/String;)V" },
      ]
    },
    code: [
      0xbb, 0x00, 0x00, // new <idx=0>
      0x59,             // dup
      0x12, 0x02,       // ldc <idx=2>
      0xb7, 0x00, 0x04, // invokespecial <idx=4>
      0xbf              // athrow
    ],
  };
  this.pushFrame(syntheticMethod, 0);
  throw VM.Yield;
}

Context.prototype.newString = function(s) {
  var obj = CLASSES.newObject(CLASSES.java_lang_String);
  var length = s.length;
    var chars = CLASSES.newPrimitiveArray("C", length);
  for (var n = 0; n < length; ++n)
    chars[n] = s.charCodeAt(n);
  obj["java/lang/String$value"] = chars;
  obj["java/lang/String$offset"] = 0;
  obj["java/lang/String$count"] = length;
  return obj;
}

Context.prototype.run = function(stopFrame) {
  while (this.current() !== stopFrame) {
    try {
      VM.execute(this);
    } catch (e) {
      if (e !== VM.Yield)
        throw e;
    }
  }
}
