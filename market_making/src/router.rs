use std::sync::Arc;

use crate::Core;
use hyper::{Body, Request, Response, StatusCode};
use log::debug;
use routerify::prelude::*;
use routerify::{Middleware, RequestInfo, Router};
use std::convert::Infallible;

pub fn router(core: Arc<Core>) -> Router<Body, Infallible> {
    Router::builder()
        .data(core)
        .middleware(Middleware::pre(logger))
        .get("/check_positions", check_positions)
        .err_handler_with_info(error_handler)
        .build()
        .unwrap()
}

async fn get_version(_req: Request<Body>) -> Result<Response<Body>, Infallible> {
    Ok(Response::new(Body::from("0.1")))
}

async fn check_positions(req: Request<Body>) -> Result<Response<Body>, Infallible> {
    // Access the app state.
    let core = req.data::<Arc<Core>>().unwrap();
    match core.get_positions() {
        Ok(positions) => match serde_json::to_string(&positions) {
            Ok(res) => Ok(Response::new(Body::from(res))),
            Err(_) => Ok(Response::new(Body::from("Cannot encode positions"))),
        },
        Err(err) => {
            println!("{err}");
            Ok(Response::new(Body::from("Cannot get positions")))
        }
    }
}

async fn error_handler(err: routerify::RouteError, _: RequestInfo) -> Response<Body> {
    debug!("{}", err);
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .body(Body::from(format!("Something went wrong: {}", err)))
        .unwrap()
}

async fn logger(req: Request<Body>) -> Result<Request<Body>, Infallible> {
    debug!(
        "{} {} {}",
        req.remote_addr(),
        req.method(),
        req.uri().path()
    );
    Ok(req)
}
